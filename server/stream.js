var fs = require('fs'),
    http = require('http'),
    entities = require('entities'),
    _ = require('underscore');

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
function getVideoTitle(type, id, callback) {
    var host, path;

    switch (type) {
        case 'youtube':
            host = 'www.youtube.com';
            path = '/watch?v=' + id;
            break;
        case 'twitch':
            host = 'www.twitch.tv';
            path = '/' + id;
            break;
        default:
            return callback(false);
            break;
    }

    console.log('Fetching video title for: [' + type + '] ' + id);
    http.get({
        host: host,
        port: 80,
        path: path
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
    this.css = obj.css || '';
    this.playing = obj.playing || false;
    this.current = ((obj.current === 0) ? 0 : (obj.current || null));
    this.time = obj.time || null;
    this.playlist = obj.playlist || [];
    this.shuffle = obj.shuffle || false;
    this.timeFrom = obj.timeFrom || secs();
    this.currentPoll = obj.currentPoll || null;
    this.mutedClients = obj.mutedClients || [];

    this.clients = [];
};

// serialise
_Stream.prototype.toJSON = function () {
    return {
        title: this.title,
        id: this.id,
        secret: this.secret,
        css: this.css,
        playing: this.playing,
        current: this.current,
        time: this.time,
        playlist: this.playlist,
        suffle: this.shuffle,
        timeFrom: this.timeFrom,
        currentPoll: this.currentPoll,
        mutedClients: this.mutedClients
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
            type: 'viewers',
            count: that.usersViewing()
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
            type: 'viewers',
            count: that.usersViewing()
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

// check if we have a given client by nick, case-insensitive
_Stream.prototype.hasNick = function (nick) {
    return !!_.find(this.clients, function (cl) {
        return cl.chat_nick && cl.chat_nick.toLowerCase() === nick.toLowerCase();
    });
};

// get a given client by nick, case-insensitive
_Stream.prototype.getByNick = function (nick) {
    var cl = _.find(this.clients, function (cl) {
        return cl.chat_nick && cl.chat_nick.toLowerCase() === nick.toLowerCase();
    });

    if (!nick) {
        throw new Error('No such nick: "' + nick + '"');
    }

    return cl;
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
_Stream.prototype.openPoll = function (title, options, nick) {
    var that = this;

    // close poll first if one already running
    if (this.hasPoll()) {
        this.closePoll(nick);
    }

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
            msg: 'Poll "' + title + '" opened by ' + nick
        });
    });
};

// closes a poll
_Stream.prototype.closePoll = function (nick) {
    var results, title;

    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }

    results = this.currentPoll.options;
    title = this.currentPoll.title;
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
            type: 'poll_results',
            results: results,
            title: title,
            closed_by: nick
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

// returns true if client is muted (by nick), else false
_Stream.prototype.isClientMuted = function (nick) {
    return _.contains(this.mutedClients, nick);
};

// mutes client, returns false on failure, 
_Stream.prototype.muteClient = function (client, nick) {
    var that = this;

    if (!_.contains(this.clients, client)) {
        throw new Error("Client is not attached to this stream.");
    }

    if (client.chat_nick === null) {
        throw new Error("Client is not in chat.");
    }

    if (client.control) {
        throw new Error("Client is controller, cannot be muted.");
    }

    // check this client isn't already muted
    if (this.isClientMuted(client.chat_nick)) {
        return;
    }

    client.prefix = '~';
    client.muted = true;
    
    this.mutedClients.push(client.chat_nick);
    saveStreams();    

    // update each client
    this.forEachClient(function (cl) {
        cl.send({
            type: 'mute',
            nick: client.chat_nick,
            by: nick
        });
    });
};

// unmutes client, returns false on failure, 
_Stream.prototype.unmuteClient = function (client, nick) {
    var that = this;

    if (!_.contains(this.clients, client)) {
        throw new Error("Client is not attached to this stream.");
    }

    if (client.chat_nick === null) {
        throw new Error("Client is not in chat.");
    }

    // check this client isn't already muted
    if (!_.contains(this.mutedClients, client.chat_nick)) {
        return;
    }

    // only one possible new prefix since controllers can't be muted
    client.prefix = '';
    client.muted = false;
    
    this.mutedClients = _.without(this.mutedClients, client.chat_nick);
    saveStreams();    

    // update each client
    this.forEachClient(function (cl) {
        cl.send({
            type: 'unmute',
            nick: client.chat_nick,
            prefix: client.prefix,
            by: nick
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
_Stream.prototype.changeTitle = function (title, nick) {
    this.title = title;

    // update each client
    this.clients.forEach(function (cl) {
        cl.send({
            type: 'change_title',
            title: title,
            by: nick
        });
    });

    saveStreams();
};

// changes CSS
_Stream.prototype.changeCSS = function (css, nick) {
    this.css = css;

    // update each client
    this.clients.forEach(function (cl) {
        cl.send({
            type: 'change_css',
            css: css,
            by: nick
        });
    });

    saveStreams();
};

// changes shuffle status
_Stream.prototype.changeShuffle = function (val) {
    this.shuffle = val;

    // update each client
    this.clients.forEach(function (cl) {
        cl.send({
            type: 'change_shuffle',
            shuffle: val
        });
    });

    saveStreams();
};

// add video to playlist
_Stream.prototype.addVideo = function (type, id) {
    var that = this;

    getVideoTitle(type, id, function (res) {
        if (res === false) {
            that.playlist.push({
                type: type,
                id: id,
                title: type + ': ' + id,
                views: 0
            });
        } else {
            that.playlist.push({
                type: type,
                id: id,
                title: res,
                views: 0
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
    var that = this;

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

    // update view count if valid video
    if (this.playlist.hasOwnProperty(newVideo)) {
        this.playlist[newVideo].views = (this.playlist[newVideo].views || 0) + 1;

        // update each client
        that.clients.forEach(function (cl) {
            cl.send({
                type: 'update_playlist',
                playlist: that.playlist,
                current: that.current
            });
        });
    }

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
