#!/usr/bin/env node

var WebSocketServer = require('websocket').server,
    http = require('http'),
    https = require('https'),
    url = require('url')
    fs = require('fs'),
    entities = require('entities');

var DEBUG_MODE = process.argv.hasOwnProperty('2') && process.argv[2] === '--debug',
    DEFAULT_ORIGIN = 'http://lunasync.ajf.me',
    DEBUG_ORIGIN = 'http://localhost:8000';

var streams = [], clients = [], accountEmails = {}, accounts = {};

function generateSecret() {
    var i, secret = '';

    for (i = 0; i < 14; i++) {
        secret += Math.floor(Math.random() * 36).toString(36)
    }
    return secret;
}

function secs() {
    return new Date().getTime() / 1000;
}

if (fs.existsSync('streams.json')) {
    var file = fs.readFileSync('streams.json');
    var data = JSON.parse(file);
    streams = data.streams;
}

if (fs.existsSync('accounts.json')) {
    var file = fs.readFileSync('accounts.json');
    var data = JSON.parse(file);
    accountEmails = data.accountEmails;
    accounts = data.accounts;
}

function saveStreams() {
    fs.writeFileSync('streams.json', JSON.stringify({
        streams: streams
    }));
    console.log('Saved streams');
}

function saveAccounts() {
    fs.writeFileSync('accounts.json', JSON.stringify({
        accounts: accounts,
        accountEmails: accountEmails
    }));
    console.log('Saved accounts');
}

var server = http.createServer(function(request, response) {
    var headers, parts, stream, id, data = '';
    console.log((new Date()) + ' Received request for ' + request.url);

    // CORS (allows access to API from other domains)
    // (needed because API server does not host static HTML/JS which uses it)
    headers = {
        'Access-Control-Allow-Origin': (DEBUG_MODE ? '*' : DEFAULT_ORIGIN),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=utf-8'
    };

    // parse path
    parts = url.parse(request.url, true);

    if (parts.pathname === '/new' && request.method === 'POST') {
        request.on('data', function (chunk) {
            data += chunk
        });
        request.on('end', function () {
            try {
                data = JSON.parse(data);
            } catch (e) {
                response.writeHead(400, headers);
                response.end(JSON.stringify({
                    error: '400 Bad Request'
                }));
                return;
            }
            stream = {
                title: data.title,
                // stream ID is base36-encoded index into array
                id: streams.length.toString(36),
                playing: false,
                current: null,
                time: null,
                playlist: [],
                timeFrom: secs(),
                // secret used to control the stream
                secret: generateSecret()
            };
            streams.push(stream);
            saveStreams();
            response.writeHead(200, headers);
            response.end(JSON.stringify({
                stream: stream
            }));
        });
    } else if (parts.pathname === '/new' && request.method === 'OPTIONS') {
        response.writeHead(200, headers);
        response.end();
    } else {
        response.writeHead(404, headers);
        response.end(JSON.stringify({
            error: '404 Page Not Found'
        }));
    }
});
server.listen(9003, function() {
    console.log((new Date()) + ' Server is listening on port 9003');
});

wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
});

wsServer.on('request', function(request) {
    var client = null;

    if (!DEBUG_MODE && request.origin !== DEFAULT_ORIGIN) {
        request.reject();
        console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
        return;
    }

    try {
        var connection = request.accept('lunasync', request.origin);
    } catch (e) {
        console.log('Caught error: ' + e);
        request.reject();
        return;
    }
    console.log((new Date()) + ' Connection accepted from IP ' + connection.remoteAddress);

    function send(msg) {
        connection.send(JSON.stringify(msg));
    }

    function sendTo(conn, msg) {
        conn.send(JSON.stringify(msg));
    }

    connection.on('message', function (message) {
        var msg, i, users, nonEmptyStreams;

        // handle unexpected packet types
        // we don't use binary frames
        if (message.type !== 'utf8') {
            connection.sendUTF(JSON.stringify({
                type: 'kick',
                reason: 'protocol_error'
            }));
            connection.close();
            return;
        }

        // every frame is a JSON-encoded packet
        try {
            msg = JSON.parse(message.utf8Data);
        } catch (e) {
            connection.sendUTF(JSON.stringify({
                type: 'kick',
                reason: 'protocol_error'
            }));
            connection.close();
            return;
        }

        switch (msg.type) {
            case 'set_stream':
                if (msg.hasOwnProperty('id')) {
                    // stream ID is base36-encoded index into array
                    id = parseInt(msg.id, 36);
                    if (streams.hasOwnProperty(id)) {
                        stream = streams[id];
                        // keep track of this client
                        // so we can send them updates
                        client = {
                            stream: stream,
                            control: stream.secret === msg.control,
                            conn: connection,
                            chat_nick: null,
                            email: null
                        };
                        clients.push(client);
                        send({
                            type: 'stream_info',
                            // don't sent stream object verbatim
                            // we don't want to reveal control secret
                            stream: {
                                title: stream.title,
                                id: stream.id,
                                playing: stream.playing,
                                current: stream.current,
                                time: stream.time + (secs() - stream.timeFrom),
                                playlist: stream.playlist
                            },
                            control: stream.secret === msg.control
                        });
                        // count users in stream chat
                        users = [];
                        clients.forEach(function (cl) {
                            if (cl.stream === client.stream && cl.chat_nick !== null) {
                                users.push(cl.chat_nick);
                            }
                        });
                        send({
                            type: 'chat_info',
                            msg: users.length + ' users in chat: ' + users.join(', ')
                        });
                        // count users viewing stream
                        users = 0;
                        clients.forEach(function (cl) {
                            if (cl.stream === client.stream) {
                                users++;
                            }
                        });
                        clients.forEach(function (cl) {
                            if (cl.stream === client.stream) {
                                sendTo(cl.conn, {
                                    type: 'chat_info',
                                    msg: 'now ' + users + ' users viewing stream'
                                });
                            }
                        });
                        console.log('now ' + users + ' users viewing stream ' + client.stream.id);
                    } else {
                        send({
                            type: 'error',
                            error: 'not_found'
                        });
                        connection.close();
                    }
                } else {
                    send({
                        type: 'error',
                        error: 'bad_request'
                    });
                    connection.close();
                }
            break;
            case 're_sync':
                send({
                    type: 'play',
                    time: stream.time + (secs() - stream.timeFrom),
                    playing: stream.playing
                });
            break;
            case 'assert':
                personaAssert(msg.assertion, function (res, email) {
                    var i, account;

                    if (!res) {
                        send({
                            type: 'error',
                            error: 'bad_persona_assertion'
                        });
                        connection.close();
                    } else {
                        client.email = email;
                        if (accountEmails.hasOwnProperty(email)) {
                            account = accounts[accountEmails[email]];

                            // check if nick is taken
                            for (i = 0; i < clients.length; i++) {
                                if (clients[i].stream === client.stream && clients[i].chat_nick === account.nick) {
                                    send({
                                        type: 'nick_in_use',
                                        nick: account.nick
                                    });
                                    return;
                                }
                            }

                            client.chat_nick = account.nick;

                            send({
                                type: 'nick_chosen',
                                nick: client.chat_nick
                            });

                            // update each client
                            clients.forEach(function (cl) {
                                if (cl.stream === client.stream) {
                                    sendTo(cl.conn, {
                                        type: 'join',
                                        nick: client.chat_nick
                                    });
                                }
                            });
                        } else {
                            send({
                                type: 'choose_nick'
                            });
                        }
                    }
                });
            break;
            case 'set_nick':
                if (!msg.nick.match(/^[a-zA-Z0-9_]{3,18}$/g)) {
                    send({
                        type: 'error',
                        error: 'bad_nick'
                    });
                    connection.close();
                    return;
                }
                if (client.email === null) {
                    send({
                        type: 'error',
                        error: 'not_logged_in'
                    });
                    connection.close();
                    return;
                }
                if (accounts.hasOwnProperty(msg.nick.toLowerCase())) {
                    send({
                        type: 'choose_nick',
                        reason: 'nick_taken'
                    });
                    return;
                }
                accountEmails[client.email] = msg.nick.toLowerCase();
                accounts[msg.nick.toLowerCase()] = {
                    email: client.email,
                    nick: msg.nick
                };
                saveAccounts();
                client.chat_nick = msg.nick;

                send({
                    type: 'nick_chosen',
                    nick: client.chat_nick
                });

                // update each client
                clients.forEach(function (cl) {
                    if (cl.stream === client.stream) {
                        sendTo(cl.conn, {
                            type: 'join',
                            nick: client.chat_nick
                        });
                    }
                });
            break;
            case 'msg':
                if (client.chat_nick === null) {
                    send({
                        type: 'error',
                        error: 'not_in_chat'
                    });
                    connection.close();
                    return;
                }
                if (msg.msg === '/stats') {
                    nonEmptyStreams = [];
                    clients.forEach(function (cl) {
                        if (nonEmptyStreams.indexOf(cl.stream) === -1) {
                            nonEmptyStreams.push(cl.stream);
                        }
                    });
                    send({
                        type: 'chat_info',
                        msg: streams.length + ' streams (' + nonEmptyStreams.length + ' active), ' + clients.length + ' users online'
                    });
                // normal message
                } else {
                    // update each client
                    clients.forEach(function (cl) {
                        if (cl.stream === client.stream) {
                            sendTo(cl.conn, {
                                type: 'msg',
                                nick: client.chat_nick,
                                msg: msg.msg
                            });
                        }
                    });
                }
            break;
            case 'update_playlist':
                // check that they have control of stream
                if (!client.control) {
                    send({
                        type: 'error',
                        error: 'not_control'
                    });
                    connection.close();
                    return;
                }
                client.stream.playlist = msg.playlist;
                client.stream.current = msg.current;

                // update each client
                clients.forEach(function (cl) {
                    if (cl.stream === client.stream) {
                        sendTo(cl.conn, {
                            type: 'update_playlist',
                            playlist: msg.playlist,
                            current: msg.current
                        });
                    }
                });
                saveStreams();
            break;
            case 'change_title':
                // check that they have control of stream
                if (!client.control) {
                    send({
                        type: 'error',
                        error: 'not_control'
                    });
                    connection.close();
                    return;
                }
                client.stream.title = msg.title;

                // update each client
                clients.forEach(function (cl) {
                    if (cl.stream === client.stream) {
                        sendTo(cl.conn, {
                            type: 'change_title',
                            title: msg.title
                        });
                    }
                });
                saveStreams();
            break;
            case 'add_url':
                // check that they have control of stream
                if (!client.control) {
                    send({
                        type: 'error',
                        error: 'not_control'
                    });
                    connection.close();
                    return;
                }
                getVideoTitle(msg.id, function (res) {
                    if (res === false) {
                        client.stream.playlist.push({
                            id: msg.id,
                            title: 'YouTube Video: ' + msg.id
                        });
                    } else {
                        client.stream.playlist.push({
                            id: msg.id,
                            title: res
                        });
                    }

                    // update each client
                    clients.forEach(function (cl) {
                        if (cl.stream === client.stream) {
                            sendTo(cl.conn, {
                                type: 'update_playlist',
                                playlist: client.stream.playlist,
                                current: client.stream.current
                            });
                        }
                    });
                    saveStreams();
                });
            break;
            case 'play':
                // check that they have control of stream
                if (!client.control) {
                    send({
                        type: 'error',
                        error: 'not_control'
                    });
                    connection.close();
                    return;
                }
                client.stream.playing = true;
                client.stream.time = msg.time;
                client.stream.timeFrom = secs();

                // update each client
                clients.forEach(function (cl) {
                    if (cl !== client && cl.stream === client.stream) {
                        sendTo(cl.conn, {
                            type: 'play',
                            time: msg.time
                        });
                    }
                });
            break;
            case 'stop':
                // check that they have control of stream
                if (!client.control) {
                    send({
                        type: 'error',
                        error: 'not_control'
                    });
                    connection.close();
                    return;
                }
                client.stream.playing = false;
                client.stream.time = msg.time;

                // update each client
                clients.forEach(function (cl) {
                    if (cl !== client && cl.stream === client.stream) {
                        sendTo(cl.conn, {
                            type: 'stop',
                            time: msg.time
                        });
                    }
                });
            break;
            case 'cue':
                // check that they have control of stream
                if (!client.control) {
                    send({
                        type: 'error',
                        error: 'not_control'
                    });
                    connection.close();
                    return;
                }
                client.stream.playing = true;
                client.stream.time = 0;
                client.stream.timeFrom = secs();
                client.stream.current = msg.current;

                // update each client
                clients.forEach(function (cl) {
                    if (cl.stream === client.stream) {
                        sendTo(cl.conn, {
                            type: 'cue',
                            current: msg.current
                        });
                    }
                });
            break;
            default:
                send({
                    type: 'error',
                    error: 'unknown_packet_type'
                });
                connection.close();
            break;
        }
    });
    connection.on('close', function () {
        // stop tracking client
        if (client !== null) {
            clients.splice(clients.indexOf(client), 1);

            // tell everyone we left if we were on chat
            if (client.chat_nick !== null) {
                clients.forEach(function (cl) {
                    if (cl.stream === client.stream) {
                        sendTo(cl.conn, {
                            type: 'leave',
                            nick: client.chat_nick
                        });
                    }
                });
            }

            // count users viewing stream
            users = 0;
            clients.forEach(function (cl) {
                if (cl.stream === client.stream) {
                    users++;
                }
            });
            clients.forEach(function (cl) {
                if (cl.stream === client.stream) {
                    sendTo(cl.conn, {
                        type: 'chat_info',
                        msg: 'now ' + users + ' users viewing stream'
                    });
                }
            });
            console.log('now ' + users + ' users viewing stream ' + client.stream.id);
        }
    });
});

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

function personaAssert (assertion, callback) {
    var postdata;

    if (DEBUG_MODE) {
        postdata = 'assertion=' + assertion + '&audience=' + DEBUG_ORIGIN;
    } else {
        postdata = 'assertion=' + assertion + '&audience=' + DEFAULT_ORIGIN;
    }

    var req = https.request({
        hostname: 'verifier.login.persona.org',
        method: 'POST',
        path: '/verify',
        headers: {
            'Content-Length': postdata.length,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            var data = JSON.parse(chunk);
            if (data.status === 'okay') {
                callback(true, data.email);
                return;
            }
            callback(false);
        });
    });

    req.on('error', function (e) {
        callback(false);
    });

    req.write(postdata);
    req.end();
};
