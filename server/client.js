var underscore = require('underscore');

var Accounts = require('./accounts.js'),
    Stream = require('./stream.js');

// internal variables and functions
var clients = [];

var availableCommands = {
    // CTCP ACTION-like (/me)
    me: {
        func: function (client, args) {
            // update each client
            client.stream.forEachClient(function (cl) {
                cl.send({
                    type: 'action',
                    nick: client.prefix + client.chat_nick,
                    msg: args
                });
            });
        },
        controllerOnly: false
    },
    // gets stats
    stats: {
        func: function (client, args) {
            var nonEmptyStreams = 0;

            Stream.forEach(function (stream) {
                if (stream.usersViewing()) {
                    nonEmptyStreams++;
                }
            });
            client.send({
                type: 'chat_info',
                msg: Stream.streamCount() + ' streams (' + nonEmptyStreams + ' active), ' + Client.clientsConnected() + ' users online'
            });
        },
        controllerOnly: false
    },
    // opens a poll
    poll: {
        func: function (client, args) {
            args = args.split(',');
            if (args.length > 2) {
                client.stream.openPoll(args[0], args.slice(1), client.chat_nick);
            } else {
                client.send({
                    type: 'chat_info',
                    msg: '/poll needs at least 2 options (e.g. /poll Best Pony,Twilight,Rainbow Dash'
                });
            }
        },
        controllerOnly: true
    },
    // closes poll
    closepoll: {
        func: function (client) {
            if (!client.stream.hasPoll()) {
                return;
            }
            client.stream.closePoll(client.chat_nick);
        },
        controllerOnly: true
    },
    // (un)mutes user
    mute: {
        func: function (client, args) {
            var nick = args, cl;

            if (!client.stream.hasNick(nick)) {
                client.send({
                    type: 'chat_info',
                    msg: '/mute requires a nick, there is no such nick in chat: "' + args + '"'
                });
                return;
            }

            cl = client.stream.getByNick(nick);

            if (cl.control) {
                client.send({
                    type: 'chat_info',
                    msg: 'You cannot mute controllers.'
                });
                return;
            }

            if (cl.muted) {
                cl.stream.unmuteClient(cl, client.chat_nick);
            } else {
                cl.stream.muteClient(cl, client.chat_nick);
            }
        },
        controllerOnly: true
    }
};

// parses command, returns [name, args] if valid, false otherwise
function parseCommand(string) {
    var pos, cmd, args;

    // must begin with /
    if (string[0] !== '/') {
        return false;
    }

    // truncate /
    string = string.substr(1);

    // find space
    pos = string.indexOf(' ');

    // no space, no arguments
    if (pos === -1) {
        return {
            name: string,
            args: ''
        };
    // split arguments into separate string
    } else {
        cmd = string.substr(0, pos);
        args = string.substr(pos + 1);
        return {
            name: cmd,
            args: args
        };
    }
}

// returns true if command exists, false otherwise
function commandExists(name) {
    return availableCommands.hasOwnProperty(name);
}

// returns true if client allowed to use command, false otherwise
function canUseCommand(client, name) {
    if (!commandExists(name)) {
        throw new Error("Command does not exist: " + name);
    }
    return (!availableCommands[name].controllerOnly || client.control);
}

// runs command
function runCommand (name, args, client) {
    if (!commandExists(name)) {
        throw new Error("Command does not exist: " + name);
    }
    if (!canUseCommand(client, name)) {
        throw new Error("Command " + name + " cannot be used by non-controllers");
    }
    availableCommands[name].func(client, args);
}

// send greetings
function greet (client) {
    var users;
    
    // user list
    users = {};
    client.stream.forEachClient(function (cl) {
        if (cl.chat_nick !== null) {
            users[cl.chat_nick] = {
                prefix: cl.prefix
            };
        }
    });
    client.send({
        type: 'chat_users',
        users: users
    });

    // inform of commands
    if (client.control) {
        client.send({
            type: 'chat_info',
            msg: 'Since you are in control of the stream, you can use the following commands:'
        });
        client.send({
            type: 'chat_info',
            msg: '/poll title,option,option,... (e.g. /poll Best Pony?,Rainbow Dash,Fluttershy,Rarity) - runs a poll'
        });
        client.send({
            type: 'chat_info',
            msg: '/closepoll - closes the poll'
        });
        client.send({
            type: 'chat_info',
            msg: '/mute nick - (un)mutes a user'
        });
    }
}

// hook client events
function hookEvents (client) {
    var connected = true;

    client.conn.on('message', function (message) {
        var msg, i, users, nonEmptyStreams, args, results, name, cmd;

        // prevent handling messages after disconnection
        if (!connected) {
            return;
        }

        // handle unexpected packet types
        // we don't use binary frames
        if (message.type !== 'utf8') {
            client.conn.sendUTF(JSON.stringify({
                type: 'kick',
                reason: 'protocol_error'
            }));
            client.conn.close();
            return;
        }

        // every frame is a JSON-encoded packet
        try {
            msg = JSON.parse(message.utf8Data);
        } catch (e) {
            client.conn.sendUTF(JSON.stringify({
                type: 'kick',
                reason: 'protocol_error'
            }));
            client.conn.close();
            return;
        }

        switch (msg.type) {
            case 'set_stream':
                if (msg.hasOwnProperty('id')) {
                    // stream ID is base36-encoded index into array
                    id = parseInt(msg.id, 36);
                    if (streams.hasOwnProperty(id)) {
                        stream = streams[id];
                        // hand over to Client
                        client = new Client(conn, stream, msg.control);
                    } else {
                        client.send({
                            type: 'error',
                            error: 'not_found'
                        });
                        client.conn.close();
                    }
                } else {
                    client.send({
                        type: 'error',
                        error: 'bad_request'
                    });
                    client.conn.close();
                }
            break;
            case 're_sync':
                client.send({
                    type: 'play',
                    time: client.stream.getRelativeTime(),
                    playing: client.stream.playing
                });
            break;
            case 'assert':
                Accounts.personaAssert(msg.assertion, function (res, email) {
                    var i, account;

                    if (!res) {
                        client.send({
                            type: 'error',
                            error: 'bad_persona_assertion'
                        });
                        client.conn.close();
                    } else {
                        client.email = email;
                        if (Accounts.haveEmail(email)) {
                            account = Accounts.getByEmail(email);

                            // check if nick is taken
                            for (i = 0; i < clients.length; i++) {
                                if (clients[i].stream === client.stream && clients[i].chat_nick === account.nick) {
                                    client.send({
                                        type: 'nick_in_use',
                                        nick: account.nick
                                    });
                                    return;
                                }
                            }

                            client.chat_nick = account.nick;
                            client.muted = !client.control && client.stream.isClientMuted(client.chat_nick);
                            client.prefix = (client.control ? '@' : client.stream.isClientMuted(client.chat_nick) ? '~' : '');

                            client.send({
                                type: 'nick_chosen',
                                nick: client.chat_nick,
                                prefix: client.prefix
                            });

                            // tell the stream
                            client.stream.onJoinChat(client);

                            // inform if muted
                            if (client.muted) {
                                client.send({
                                    type: 'chat_info',
                                    msg: 'You are currently muted and cannot send messages.'
                                });
                            }

                            // update each client
                            client.stream.forEachClient(function (cl) {
                                cl.send({
                                    type: 'join',
                                    prefix: client.prefix,
                                    nick: client.chat_nick
                                });
                            });
                        } else {
                            client.send({
                                type: 'choose_nick'
                            });
                        }
                    }
                });
            break;
            case 'set_nick':
                if (!msg.nick.match(/^[a-zA-Z0-9_]{3,18}$/g)) {
                    client.send({
                        type: 'error',
                        error: 'bad_nick'
                    });
                    client.conn.close();
                    return;
                }
                if (client.email === null) {
                    client.send({
                        type: 'error',
                        error: 'not_logged_in'
                    });
                    client.conn.close();
                    return;
                }
                if (Accounts.haveEmail(client.email)) {
                    client.send({
                        type: 'error',
                        error: 'already_have_nick_for_email'
                    });
                    client.conn.close();
                    return;
                }
                if (Accounts.haveNick(msg.nick)) {
                    client.send({
                        type: 'choose_nick',
                        reason: 'nick_taken'
                    });
                    return;
                }
                Accounts.add(client.email, msg.nick);
                client.chat_nick = msg.nick;
                client.muted = !client.control && client.stream.isClientMuted(client.chat_nick);
                client.prefix = (client.control ? '@' : client.stream.isClientMuted(client.chat_nick) ? '~' : '');

                client.send({
                    type: 'nick_chosen',
                    nick: client.chat_nick,
                    prefix: client.prefix
                });

                // tell the stream
                client.stream.onJoinChat(client);

                // inform if muted
                if (client.muted) {
                    client.send({
                        type: 'chat_info',
                        msg: 'You are currently muted and cannot send messages.'
                    });
                }

                // update each client
                client.stream.forEachClient(function (cl) {
                    cl.send({
                        type: 'join',
                        nick: client.chat_nick,
                        prefix: client.prefix
                    });
                });
            break;
            case 'msg':
                if (client.chat_nick === null) {
                    client.send({
                        type: 'error',
                        error: 'not_in_chat'
                    });
                    client.conn.close();
                    return;
                }
                // command
                if (msg.msg[0] === '/') {
                    if (client.muted) {
                        client.send({
                            type: 'chat_info',
                            msg: 'You are currently muted, your command was not run: "' + msg.msg + '"'
                        });
                        return;
                    }
                    cmd = parseCommand(msg.msg);
                    if (!commandExists(cmd.name)) {
                        client.send({
                            type: 'chat_info',
                            msg: 'There is no command named ' + cmd.name
                        });
                        return;
                    }
                    if (!canUseCommand(client, cmd.name)) {
                        client.send({
                            type: 'chat_info',
                            msg: 'Only controllers can use the command named ' + cmd.name
                        });
                        return;
                    }
                    runCommand(cmd.name, cmd.args, client);
                // normal message
                } else {
                    if (client.muted) {
                        client.send({
                            type: 'chat_info',
                            msg: 'You are currently muted, your message was not sent: "' + msg.msg + '"'
                        });
                        return;
                    }
                    // update each client
                    client.stream.forEachClient(function (cl) {
                        cl.send({
                            type: 'msg',
                            nick: client.prefix + client.chat_nick,
                            msg: msg.msg
                        });
                    });
                }
            break;
            case 'vote':
                if (client.chat_nick === null) {
                    client.send({
                        type: 'error',
                        error: 'not_in_chat'
                    });
                    client.conn.close();
                    return;
                }
                if (!client.stream.hasPoll()) {
                    client.send({
                        type: 'error',
                        error: 'no_such_poll'
                    });
                    client.conn.close();
                    return;
                }
                if (client.stream.hasVoted(client)) {
                    client.send({
                        type: 'error',
                        error: 'already_voted'
                    });
                    client.conn.close();
                    return;
                }
                if (!client.stream.hasPollOption(msg.option)) {
                    client.send({
                        type: 'error',
                        error: 'no_such_option'
                    });
                    client.conn.close();
                    return;
                }

                client.stream.vote(client, msg.option);
            break;
            case 'update_playlist':
                // check that they have control of stream
                if (!client.control) {
                    client.send({
                        type: 'error',
                        error: 'not_control'
                    });
                    client.conn.close();
                    return;
                }

                client.stream.updatePlaylist(msg.playlist, msg.current);
            break;
            case 'change_title':
                // check that they have control of stream
                if (!client.control) {
                    client.send({
                        type: 'error',
                        error: 'not_control'
                    });
                    client.conn.close();
                    return;
                }

                client.stream.changeTitle(msg.title, client.chat_nick);
            break;
            case 'change_css':
                // check that they have control of stream
                if (!client.control) {
                    client.send({
                        type: 'error',
                        error: 'not_control'
                    });
                    client.conn.close();
                    return;
                }

                client.stream.changeCSS(msg.css, client.chat_nick);
            break;
            case 'change_shuffle':
                // check that they have control of stream
                if (!client.control) {
                    client.send({
                        type: 'error',
                        error: 'not_control'
                    });
                    client.conn.close();
                    return;
                }

                client.stream.changeShuffle(msg.shuffle);
            break;
            case 'add_url':
                // check that they have control of stream
                if (!client.control) {
                    client.send({
                        type: 'error',
                        error: 'not_control'
                    });
                    client.conn.close();
                    return;
                }

                client.stream.addVideo(msg.videotype || "youtube", msg.id);
            break;
            case 'play':
                // check that they have control of stream
                if (!client.control) {
                    client.send({
                        type: 'error',
                        error: 'not_control'
                    });
                    client.conn.close();
                    return;
                }

                client.stream.play(msg.time, client);
            break;
            case 'stop':
                // check that they have control of stream
                if (!client.control) {
                    client.send({
                        type: 'error',
                        error: 'not_control'
                    });
                    client.conn.close();
                    return;
                }

                client.stream.play(msg.time, client);
            break;
            case 'cue':
                // check that they have control of stream
                if (!client.control) {
                    client.send({
                        type: 'error',
                        error: 'not_control'
                    });
                    client.conn.close();
                    return;
                }

                client.stream.cue(msg.current);
            break;
            default:
                client.send({
                    type: 'error',
                    error: 'unknown_packet_type'
                });
                client.conn.close();
            break;
        }
    });
    client.conn.on('close', function () {
        // prevent handling event after disconnection
        if (!connected) {
            return;
        }
        connected = false;
        client.destroy();
    });
}

// constructor
function Client (conn, stream, secret) {
    var users;
    
    this.conn = conn;
    this.stream = stream;
    this.control = stream.secret === secret;
    this.chat_nick = null;
    this.email = null;
    this.poll_vote = null;
    this.prefix = '';
    this.muted = false;

    this.send({
        type: 'stream_info',
        // don't sent stream object verbatim
        // we don't want to reveal control secret
        stream: {
            title: stream.title,
            id: stream.id,
            css: stream.css,
            playing: stream.playing,
            current: stream.current,
            time: stream.getRelativeTime(),
            shuffle: stream.shuffle,
            playlist: stream.playlist,
            poll: (stream.hasPoll() ? stream.getPoll() : null),
            viewers: stream.clientsViewing()
        },
        control: this.control
    });

    clients.push(this);
    stream.addClient(this);

    hookEvents(this);

    greet(this);
}

// send packet
Client.prototype.send = function (msg) {
    this.conn.send(JSON.stringify(msg));
};

// clear up
Client.prototype.destroy = function () {
    var that = this;

    // stop tracking client
    clients.splice(clients.indexOf(this), 1);

    // tell everyone we left if we were on chat
    if (this.chat_nick !== null) {
        this.stream.forEachClient(function (cl) {
            cl.send({
                type: 'leave',
                nick: that.chat_nick,
                prefix: that.prefix
            });
        });
    }

    // stop stream tracking client
    this.stream.removeClient(this);
};

// get client count
Client.clientsConnected = function () {
    return clients.length;
};

// disconnect all clients and send update messages
Client.update = function () {
    clients.forEach(function (client) {
        client.send({
            type: 'update'
        });
        client.conn.close();
    });
};

module.exports = Client;
