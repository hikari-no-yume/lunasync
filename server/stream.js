var fs = require('fs'),
    http = require('http'),
    entities = require('entities');

// internal variables and functions
var streams = [];

function secs() {
    return new Date().getTime() / 1000;
}

function loadStreams() {
    if (fs.existsSync('streams.json')) {
        var file = fs.readFileSync('streams.json');
        var data = JSON.parse(file);

        // deserialise each stream
        data.streams.forEach(function (stream) {
            streams.push(new _Stream(stream));
        });
    }
}

function saveStreams() {
    fs.writeFileSync('streams.json', JSON.stringify({
        streams: streams
    }));
    console.log('Saved streams');
}

// generates 14-digit base36 secret
function generateSecret() {
    var i, secret = '';

    for (i = 0; i < 14; i++) {
        secret += Math.floor(Math.random() * 36).toString(36)
    }
    return secret;
}

// fetches YouTube video title
function getVideoTitle(id, callback) {
    console.log('Fetching video title for: ' + id);
    http.get({
        host: 'www.youtube.com',
        port: 80,
        path: '/watch?v=' + id
    }, function (res) {
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            data += chunk;
        });
        res.on('end', function () {
            var pos, pos2, title;

            pos = data.indexOf('<title>');
            if (pos !== -1) {
                pos2 = data.indexOf('</title>', pos);
                if (pos2 !== -1) {
                    title = data.substr(pos + 7, pos2 - (pos + 7));
                    // decode HTML entities
                    title = entities.decode(title, 2);
                    callback(title);
                } else {
                    callback(false);
                }
            } else {
                callback(false);
            }
        });
    }).on('error', function (err) {
        callback(false);
    });
}

// internal Stream constructor
// (deserialises from object with default)
function _Stream(obj) {
    this.title = obj.title;
    this.id = obj.id;
    this.secret = obj.secret;
    this.playing = obj.playing || false;
    this.current = obj.current || null;
    this.time = obj.time || null;
    this.playlist = obj.playlist || [];
    this.timeFrom = obj.timeFrom || secs();
    this.currentPoll = obj.currentPoll || null;
    this.clients = [];
};

// serialise
_Stream.prototype.toJSON = function () {
    return {
        title: this.title,
        id: this.id,
        secret: this.secret,
        playing: this.playing,
        time: this.time,
        playlist: this.playlist,
        timeFrom: this.timeFrom,
        currentPoll: this.currentPoll
    };
};

// chat join h[oo|ac]k
_Stream.prototype.onJoinChat = function (client) {
    var that = this;

    // set poll_vote value to track if they already voted, where poll active
    if (this.hasPoll()) {
        Object.keys(this.currentPoll.options).forEach(function (option) {
            if (that.currentPoll.options[option].indexOf(client.chat_nick) !== -1) {
                client.poll_vote = option;
            }
        });
        client.send({
            type: 'poll',
            poll: this.getPoll(),
            poll_vote: client.poll_vote
        });
    }
};

// adds client to internal list
_Stream.prototype.addClient = function (client) {
    var that = this;

    if (this.clients.indexOf(client) !== -1) {
        throw new Error('Client already in list.');
    }

    this.clients.push(client);

    // count users viewing stream
    this.forEachClient(function (cl) {
        cl.send({
            type: 'chat_info',
            msg: 'now ' + that.usersViewing() + ' users viewing stream'
        });
    });
    console.log('now ' + this.usersViewing() + ' users viewing stream ' + this.id);
};

// removes client from internal list
_Stream.prototype.removeClient = function (client) {
    var that = this;

    if (this.clients.indexOf(client) === -1) {
        throw new Error('Client is not in list.');
    }

    this.clients.splice(this.clients.indexOf(client), 1);

    // count users viewing stream
    this.forEachClient(function (cl) {
        cl.send({
            type: 'chat_info',
            msg: 'now ' + that.usersViewing() + ' users viewing stream'
        });
    });
    console.log('now ' + this.usersViewing() + ' users viewing stream ' + this.id);
};

// return number of users viewing stream
_Stream.prototype.usersViewing = function () {
    return this.clients.length;
};

// iterate over each client, calling callback for each
_Stream.prototype.forEachClient = function (callback) {
    this.clients.forEach(callback);
};

// returns count of clients viewing
_Stream.prototype.clientsViewing = function () {
    return this.clients.length;
};

// returns relative time (adjusted since last update)
_Stream.prototype.getRelativeTime = function () {
    return this.time + (secs() - this.timeFrom);
};

// returns poll data
_Stream.prototype.getPoll = function () {
    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }
    return this.currentPoll;
};

// opens a poll
_Stream.prototype.openPoll = function (title, options) {
    var that = this;

    this.currentPoll = {
        title: title,
        options: {}
    };
    options.forEach(function (arg) {
        that.currentPoll.options[arg] = [];
    });
    
    saveStreams();

    // update each client
    this.forEachClient(function (cl) {
        cl.poll_vote = null;
        cl.send({
            type: 'poll',
            poll: that.getPoll(),
            poll_vote: cl.poll_vote
        });
        cl.send({
            type: 'chat_info',
            msg: 'Poll opened'
        });
    });
};

// closes a poll
_Stream.prototype.closePoll = function () {
    var results, that = this;

    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }

    results = this.currentPoll.title + ' results: ';
    Object.keys(this.currentPoll.options).forEach(function (option) {
        results += option + ' - ' + that.currentPoll.options[option] + ' votes;';
    });

    this.currentPoll = null;
    saveStreams();

    // update each client
    this.forEachClient(function (cl) {
        cl.poll_vote = null;
        cl.send({
            type: 'poll',
            poll: null,
            poll_vote: cl.poll_vote
        });
        cl.send({
            type: 'chat_info',
            msg: 'Poll closed - ' + results
        });
    });
};

// returns true if we have a poll
_Stream.prototype.hasPoll = function () {
    return !!this.currentPoll;
};

// returns true if given client has already voted
_Stream.prototype.hasVoted = function (client) {
    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }
    return (client.poll_vote !== null);
};

// returns true if there is such a poll option
_Stream.prototype.hasPollOption = function (option) {
    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }
    return this.currentPoll.options.hasOwnProperty(option);
};

// makes vote
_Stream.prototype.vote = function (client, option) {
    var that = this;

    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }
    if (this.hasVoted(client)) {
        throw new Error("Client has already voted.");
    }
    if (!this.hasPollOption(option)) {
        throw new Error("No such poll option: " + option);
    }
    this.currentPoll.options[option].push(client.chat_nick);
    client.poll_vote = option;
    saveStreams();

    // update each client
    this.clients.forEach(function (cl) {
        cl.send({
            type: 'poll',
            poll: that.getPoll(),
            poll_vote: cl.poll_vote
        });
    });
};

// updates playlist
_Stream.prototype.updatePlaylist = function (playlist, current) {
    this.playlist = playlist;
    this.current = current;

    // update each client
    this.clients.forEach(function (cl) {
        cl.send({
            type: 'update_playlist',
            playlist: playlist,
            current: current
        });
    });

    saveStreams();
};

// changes title
_Stream.prototype.changeTitle = function (title) {
    this.title = title;

    // update each client
    this.clients.forEach(function (cl) {
        cl.send({
            type: 'change_title',
            title: title
        });
    });

    saveStreams();
};

// add video to playlist
_Stream.prototype.addVideo = function (id) {
    var that = this;

    getVideoTitle(id, function (res) {
        if (res === false) {
            that.playlist.push({
                id: id,
                title: 'YouTube Video: ' + id
            });
        } else {
            that.playlist.push({
                id: id,
                title: res
            });
        }

        // update each client
        that.clients.forEach(function (cl) {
            cl.send({
                type: 'update_playlist',
                playlist: that.playlist,
                current: that.current
            });
        });

        saveStreams();
    });
};

// play current video
_Stream.prototype.play = function (time, origin) {
    this.playing = true;
    this.time = time;
    this.timeFrom = secs();

    // update each client
    this.clients.forEach(function (cl) {
        if (cl !== origin) {
            cl.send({
                type: 'play',
                time: time
            });
        }
    });

    saveStreams();
};

// stop current video
_Stream.prototype.stop = function (time, origin) {
    this.playing = false;
    this.time = time;
    this.timeFrom = secs();

    // update each client
    this.clients.forEach(function (cl) {
        if (cl !== origin) {
            cl.send({
                type: 'stop',
                time: time
            });
        }
    });

    saveStreams();
};

// cue new video
_Stream.prototype.cue = function (newVideo) {
    this.playing = true;
    this.time = 0;
    this.timeFrom = secs();
    this.current = newVideo;

    // update each client
    this.clients.forEach(function (cl) {
        cl.send({
            type: 'cue',
            current: newVideo
        });
    });

    saveStreams();
};

// public Stream constructor (new stream)
function Stream(title) {
    var id, secret, s;

    // choose next ID (used in /<id> URL, base36-encoded index)
    id = streams.length.toString(36);

    // generate new secret used to control the stream
    secret = generateSecret();

    s = new _Stream({
        id: id,
        secret: secret,
        title: title
    });

    streams.push(s);

    return s;
}

// iterates over each stream and calls callback for each
Stream.forEach = function (callback) {
    streams.forEach(callback);
};

// do we have such a stream?
Stream.haveStream = function (id) {
    // stream ID is base36-encoded index into array
    id = parseInt(id, 36);
    return streams.hasOwnProperty(id);
};

// stream count
Stream.streamCount = function () {
    return streams.length;
};

// get a stream by ID
Stream.get = function (id) {
    if (!this.haveStream(id)) {
        throw new Error("No such stream: " + id);
    }
    return streams[parseInt(id, 36)];
};

loadStreams();

module.exports = Stream;
