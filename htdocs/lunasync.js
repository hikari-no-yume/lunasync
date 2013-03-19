(function () {
    'use strict';

    var API_SERVER = window.location.hostname + ':9003',
        SITE_URL = 'http://lunasync.ajf.me';

    var mode, socket, player, ytReady = false, errored = false;

    var state = {
        playing: false,
        current: null,
        playlist: [],
        poll: null,
        users: [],
        viewers: 0
    }, haveControl = false, pollVote = null, chatNick = null;

    function $(id) {
        return document.getElementById(id);
    }

    window.onYouTubePlayerReady = function () {
        ytReady = true;
        player = $('player');
        // reload page if youtube player reloads to avoid initialising twice
        window.onYouTubePlayerReady = function () { window.location.reload(); };
    };

    window.onload = function () {
        var id, control;

        // get them before IE errors out
        if (!Object.prototype.hasOwnProperty.call(window, 'WebSocket')) {
            document.innerHTML = 'lunasync requires a browser that supports WebSocket, such as Google Chrome, Mozilla Firefox, Apple Safari, Opera or Internet Explorer 10. Sorry :(';
            return;
        }

        // disable document-hiding style
        $('site').className = '';

        // display basic UI elements present on all pages
        initBasic();

        // display correct page for URL
        if (window.location.pathname === '/') {
            mode = 'home';
            initHome();
        } else if (window.location.pathname[0] === '/') {
            mode = 'view';
            id = window.location.pathname.substr(1);
            // get secret from URL hash
            if (window.location.hash.substr(0, 9) === '#control=') {
                control = window.location.hash.substr(9);
            // if using legacy query string format, redirect
            } else if (window.location.search.substr(0, 9) === '?control=') {
                control = window.location.search.substr(9);
                window.location = '/' + id + '#control=' + control;
                return;
            // get secret from localStorage if we had it backed up and redirect
            } else if (localStorage.getItem('secret-' + id) !== null) {
                control = localStorage.getItem('secret-' + id);
                window.location = '/' + id + '#control=' + control;
            }
            initView(id, control);
        } else {
            mode = '404';
            init404();
        }
    };

    function doAJAX(method, url, data, callback, errback) {
        var xhr;

        xhr = new XMLHttpRequest();
        xhr.open(method, 'http://' + API_SERVER + url);
        xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    callback(JSON.parse(xhr.responseText));
                } else {
                    errback(xhr);
                }
            }
        };
        if (data) {
            xhr.send(JSON.stringify(data));
        } else {
            xhr.send();
        }
    }

    function appendText(parent, text) {
        parent.appendChild(document.createTextNode(text));
    }

    function appendTextAutoLink(parent, text) {
        var pos;
        while (((pos = text.indexOf('http://')) !== -1) || ((pos = text.indexOf('https://')) !== -1)) {
            var pos2 = text.indexOf(' ', pos);
            var anchor = document.createElement('a');
            anchor.className = 'chat-link';
            anchor.target = '_blank';
            if (pos2 === -1) {
                appendText(parent, text.substr(0, pos));
                anchor.href = text.substr(pos);
                appendText(anchor, text.substr(pos));

                text = '';
            } else {
                appendText(parent, text.substr(0, pos));
                anchor.href = text.substr(pos, pos2 - pos);
                appendText(anchor, text.substr(pos, pos2 - pos));
                text = text.substr(pos2);
            }
            parent.appendChild(anchor);
        }
        appendText(parent, text);
    }

    function send(msg) {
        socket.send(JSON.stringify(msg));
    }

    function scrollChatlog() {
        $('chatlog').scrollTop = $('chatlog').scrollHeight;
    }

    function initBasic() {
        $('create-new').onclick = function () {
            var title;

            title = prompt('Enter a title:', '');
            if (title) {
                doAJAX('POST', '/new', {
                    title: title
                }, function (response) {
                    // back up the secret
                    localStorage.setItem('secret-' + response.stream.id, response.stream.secret);
                    window.location = '/' + response.stream.id + '#control=' + response.stream.secret;
                }, function (xhr) {
                    alert('Error while trying to create new sync:\nResponse code:\n' + xhr.status + '\nError message:' + xhr.responseText);
                });
            }
        };
    }

    // homepage
    function initHome() {
        // unhide home page
        $('homepage').className = '';
    }

    // sync viewing page
    function initView(id, control) {
        // unhide view page
        $('viewpage').className = '';

        if (!ytReady) {
            window.onYouTubePlayerReady = function () {
                player = $('player');
                // reload page if youtube player reloads to avoid initialising twice
                window.onYouTubePlayerReady = function () { window.location.reload(); };
                initRestView(id, control);
            };
        } else {
            initRestView(id, control);
        }
    }

    // selectedOptions support emulation for Firefox
    function selectedOptions(select) {
        var list = [], i;

        if (select.hasOwnProperty('selectedOptions')) {
            return select.selectedOptions;
        } else {
            for (i = 0; i < select.options.length; i++) {
                if (select.options[i].selected) {
                    list.push(select.options[i]);
                }
            }
            return list;
        }
    }

    function initRestView(id, control) {
        var url;

        window.onStateChange = function (pstate) {
            var cueIndex;

            // if we are controlling
            if (haveControl) {
                // if video paused and it was playing according to known state
                if (pstate === 2 /* YT.PlayerState.PAUSED */ && state.playing) {
                    // broadcast state change
                    send({
                        type: 'stop',
                        time: player.getCurrentTime()
                    });
                    state.playing = false;
                // if video started playing and it was paused according to known state
                } else if (pstate === 1 /*YT.PlayerState.PLAYING*/ && !state.playing) {
                    // broadcast state change
                    send({
                        type: 'play',
                        time: player.getCurrentTime()
                    });
                    state.playing = true;
                // if the video ended
                } else if (pstate === 0 /*YT.PlayerState.ENDED*/) {
                    // if we haven't reached the end of the playlist
                    if (state.current + 1 < state.playlist.length) {
                        // cue next video
                        cueIndex = state.current + 1;
                    } else {
                        // cue first video
                        cueIndex = 0;
                    }

                    state.current = cueIndex;
                    state.playing = true;

                    send({
                        type: 'cue',
                        current: cueIndex
                    });

                    player.loadVideoById(state.playlist[cueIndex].id);

                    updatePlaylist();
                }
            }
        };
        player.addEventListener('onStateChange', 'onStateChange');

        socket = new WebSocket('ws://' + API_SERVER, ['lunasync']);
        socket.onopen = function () {
            // set our stream (subscribe to events) and get info on it
            send({
                type: 'set_stream',
                id: id,
                control: control
            });
        };
        socket.onerror = socket.onclose = function (err) {
            if (errored) {
                return;
            }
            $('viewpage').innerHTML = 'Error communicating with server, lost connection (server may be down, lunasync may have updated, try refreshing):\n' + err;
            errored = true;
        };
        socket.onmessage = function (event) {
            var msg, stream, elem, elem2, nick;

            msg = JSON.parse(event.data);

            switch (msg.type) {
                case 'stream_info':
                    stream = msg.stream;

                    // display stream title
                    $('title').value = stream.title;
                    document.title = stream.title + ' - lunasync';

                    // display stream viewing URL
                    $('view-link').value = SITE_URL + '/' + stream.id;

                    // update state
                    state.playing = stream.playing;
                    state.current = stream.current;
                    state.playlist = stream.playlist;
                    state.poll = stream.poll;
                    state.viewers = stream.viewers;

                    // display playlist
                    updatePlaylist();

                    // display poll
                    updatePoll();

                    // display user count
                    updateUsersOnline();

                    // cue and play correct video
                    state.playing = stream.playing;
                    state.current = stream.current;
                    if (state.current !== null && state.playlist.length) {
                        if (state.playing) {
                            player.loadVideoById(state.playlist[state.current].id, stream.time);
                        } else {
                            player.cueVideoById(state.playlist[state.current].id, stream.time);
                        }
                    }

                    // if we have control of the stream
                    if (msg.control) {
                        haveControl = true;

                        // allow changing title
                        $('title').disabled = false;
                        $('title').onchange = function () {
                            send({
                                type: 'change_title',
                                title: $('title').value
                            });
                            document.title = $('title').value + ' - lunasync';
                        };

                        // unhide control box
                        $('control').className = '';

                        // display stream control URL
                        $('control-link').value = SITE_URL + '/' + stream.id + '#control=' + control;

                        // enable stream controls
                        $('rm-button').disabled = false;
                        $('rm-button').onclick = function () {
                            var i, items = selectedOptions($('playlist')), oldCurrent, current;

                            oldCurrent = current = state.playlist[state.current];

                            // remove selected playlist items
                            for (i = 0; i < items.length; i++) {
                                // if currently playing video being deleted, switch to next
                                if (state.playlist[items[i].dataLSindex] === current) {
                                    // loop around
                                    if (items[i].dataLSindex + 1 < state.playlist.length) {
                                        current = state.playlist[items[i].dataLSindex + 1];
                                    } else {
                                        current = state.playlist[0];
                                    }
                                }
                                state.playlist.splice(items[i].dataLSindex, 1);
                            }

                            updatePlaylist();

                            // push update to server by overwriting playlist
                            // (this may create race conditions...)
                            send({
                                type: 'update_playlist',
                                playlist: state.playlist,
                                current: state.current
                            });

                            if (current !== state.playlist[state.current]) {
                                if (current !== null && state.playlist.indexOf(current) !== -1) {
                                    current = state.playlist.indexOf(current);
                                    send({
                                        type: 'cue',
                                        current: current
                                    });
                                } else {
                                    send({
                                        type: 'cue',
                                        current: null
                                    });
                                }
                            }
                        };

                        $('play-button').disabled = false;
                        $('play-button').onclick = $('playlist').ondblclick = function () {
                            var cueIndex;

                            if (selectedOptions($('playlist')).length === 0) {
                                cueIndex = 0;
                            } else {
                                cueIndex = selectedOptions($('playlist'))[0].dataLSindex;
                            }

                            send({
                                type: 'cue',
                                current: cueIndex
                            });
                        };

                        $('move-up-btn').disabled = false;
                        $('move-up-btn').onclick = function () {
                            var i, items = selectedOptions($('playlist')), item;

                            // move selected playlist items up
                            for (i = 0; i < items.length; i++) {
                                if (items[i].dataLSindex - 1 >= 0) {
                                    item = state.playlist.splice(items[i].dataLSindex, 1);
                                    state.playlist.splice(items[i].dataLSindex - 1, 0, item[0]);
                                    if (state.current === items[i].dataLSindex) {
                                        state.current--;
                                    }
                                    updatePlaylist();
                                }
                            }

                            // push update to server by overwriting playlist
                            // (this may create race conditions...)
                            send({
                                type: 'update_playlist',
                                playlist: state.playlist,
                                current: state.current
                            });
                        };

                        $('move-down-btn').disabled = false;
                        $('move-down-btn').onclick = function () {
                            var i, items = selectedOptions($('playlist')), item;

                            // move selected playlist items up
                            for (i = 0; i < items.length; i++) {
                                if (items[i].dataLSindex + 1 < state.playlist.length) {
                                    item = state.playlist.splice(items[i].dataLSindex, 1);
                                    state.playlist.splice(items[i].dataLSindex + 1, 0, item[0]);
                                    if (state.current === items[i].dataLSindex) {
                                        state.current++;
                                    }
                                    updatePlaylist();
                                }
                            }

                            // push update to server by overwriting playlist
                            // (this may create race conditions...)
                            send({
                                type: 'update_playlist',
                                playlist: state.playlist,
                                current: state.current
                            });
                        };

                        $('add-url').disabled = false;
                        $('add-url').onkeypress = function (e) {
                            var videoID;

                            // enter
                            if (e.which === 13) {
                                e.preventDefault();
                                $('add-url').blur();
                                videoID = getVideoID($('add-url').value);
                                if (videoID !== false) {
                                    send({
                                        type: 'add_url',
                                        id: videoID
                                    });
                                    $('add-url').value = '';
                                } else {
                                    alert($('add-url').value + ' is not a valid youtube URL!');
                                }
                                return false;
                            }
                        };
                        $('playlist').disabled = false;
                    } else {
                        // only enable re-sync button if not in control
                        // (otherwise is a fairly fruitless exercise)
                        $('re-sync-btn').disabled = false;
                        $('re-sync-btn').onclick = function () {
                            send({
                                type: 're_sync'
                            });
                        };
                    }

                    // make chat work
                    $('login-btn').disabled = false;
                    $('login-btn').onclick = function () {
                        navigator.id.request();
                    };
                    $('chatbox').placeholder = 'choose a nick (press enter)';
                    $('chatbox').onkeypress = function (e) {
                        // enter
                        if (e.which === 13) {
                            e.preventDefault();
                            if (chatNick === null) {
                                send({
                                    type: 'set_nick',
                                    nick: $('chatbox').value
                                });
                                $('chatbox').disabled = true;
                            } else {
                                send({
                                    type: 'msg',
                                    msg: $('chatbox').value
                                });
                            }
                            $('chatbox').value = '';
                            return false;
                        }
                    };
                    navigator.id.watch({
                        loggedInUser: null,
                        onlogin: function (assertion) {
                            if (chatNick === null) {
                                send({
                                    type: 'assert',
                                    assertion: assertion
                                });
                                $('login-btn').disabled = true;
                                $('login-btn').innerHTML = 'logging in...';
                            }
                        },
                        onlogout: function () {
                            window.location.reload();
                        }
                    });
                    window.onresize = scrollChatlog;
                break;
                case 'update_playlist':
                    state.playlist = msg.playlist;
                    state.current = msg.current;
                    updatePlaylist();
                break;
                case 'change_title':
                    $('title').value = msg.title;
                    document.title = msg.title + ' - lunasync';
                break;
                case 'cue':
                    state.playing = true;
                    state.current = msg.current;
                    if (state.current === null) {
                        player.cueVideoById('');
                    } else {
                        player.loadVideoById(state.playlist[state.current].id);
                    }
                    updatePlaylist();
                break;
                case 'play':
                    state.playing = true;
                    player.seekTo(msg.time, true);
                    player.playVideo();
                break;
                case 'stop':
                    state.playing = false;
                    player.seekTo(msg.time, true);
                    player.pauseVideo();
                break;
                case 'join':
                    elem = document.createElement('div');
                    elem.className = 'chat-join';
                    elem.appendChild(document.createTextNode('* ' + msg.nick + ' joined chat'));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    state.users.push(msg.nick);
                    updateUsersOnline();
                break;
                case 'leave':
                    elem = document.createElement('div');
                    elem.className = 'chat-leave';
                    elem.appendChild(document.createTextNode('* ' + msg.nick + ' left chat'));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    if (state.users.indexOf(msg.nick) !== -1) {
                        state.users.splice(state.users.indexOf(msg.nick), 1);
                        updateUsersOnline();
                    }
                break;
                case 'poll':
                    state.poll = msg.poll;
                    pollVote = msg.poll_vote;
                    updatePoll();
                break;
                case 'chat_users':
                    state.users = msg.users;
                    updateUsersOnline();
                break;
                case 'viewers':
                    state.viewers = msg.count;
                    updateUsersOnline();
                break;
                case 'msg':
                    elem = document.createElement('div');
                    elem2 = document.createElement('span');
                    elem2.className = 'chat-nick';
                    elem2.appendChild(document.createTextNode(msg.nick));
                    elem.appendChild(elem2);
                    elem.appendChild(document.createTextNode(': '));
                    appendTextAutoLink(elem, msg.msg);
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                break;
                case 'chat_info':
                    elem = document.createElement('div');
                    elem.className = 'chat-info';
                    elem.appendChild(document.createTextNode('* ' + msg.msg));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                break;
                case 'nick_chosen':
                    $('chatbox').placeholder = 'say something (press enter)';
                    chatNick = msg.nick;
                    $('chatbox').disabled = false;
                    $('login-btn').className = 'unloaded';
                    $('chatbox').className = '';
                    $('logout-btn').className = '';
                    $('logout-btn').onclick = function () {
                        navigator.id.logout();
                    };
                    updatePoll();
                break;
                case 'nick_in_use':
                    alert('The nick "' + msg.nick + '" is in use - log out first.');
                    $('login-btn').className = 'unloaded';
                break;
                case 'choose_nick':
                    nick = prompt((msg.reason === 'nick_taken' ? 'That nickname was taken. ' : '') + "Choose your nickname (3-18 characters, digits, letters and underscores only):");
                    if (nick === null) {
                        $('login-btn').innerHTML = 'Log in';
                        $('login-btn').disabled = false;
                        return;
                    }
                    while (!nick.match(/^[a-zA-Z0-9_]{3,18}$/g)) {
                        nick = prompt("That nickname wasn't valid.\nChoose your nickname (3-18 characters, digits, letters and underscores only):");
                        if (nick === null) {
                            $('login-btn').innerHTML = 'Log in';
                            $('login-btn').disabled = false;
                            return;
                        }
                    }
                    send({
                        type: 'set_nick',
                        nick: nick
                    });
                break;
                case 'update':
                    elem = document.createElement('div');
                    elem.className = 'chat-update';
                    elem.appendChild(document.createTextNode('* lunasync is updating, page will refresh in 5 seconds'));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    errored = true;
                    setTimeout(function () {
                        window.location.reload();
                    }, 5000);
                break;
                case 'error':
                    if (msg.error === 'not_found') {
                        document.title = 'stream not found - lunasync';
                        $('viewpage').innerHTML = 'Error: no such stream exists. Did you copy the URL correctly?';
                    } else {
                        $('viewpage').innerHTML = 'Error communicating with server, lost connection:\n' + msg.error;
                    }
                    errored = true;
                break;
            }
        };
    }

    // "404" page
    function init404() {
        document.title = '404 not found - lunasync';
        // unhide 404 page
        $('page404').className = '';
    }

    function updatePlaylist() {
        var i, option;

        $('playlist').innerHTML = '';
        for (i = 0; i < state.playlist.length; i++) {
            option = document.createElement('option');
            if (state.current === i) {
                option.appendChild(document.createTextNode('▶ '));
                option.className = 'now-playing';
            }
            option.appendChild(document.createTextNode(state.playlist[i].title));
            option.dataLSindex = i;
            $('playlist').appendChild(option);
        }
    }


    function updateUsersOnline() {
        var i, elem, option;

        // sort list first
        state.users.sort(function (a, b) {
            a = a.toLowerCase();
            b = b.toLowerCase();
            if (a < b) {
                return -1;
            } else if (a > b) {
                return 1;
            }
            return 0;
        });
        $('users-online').innerHTML = state.users.length + '/' + state.viewers + ' viewers in chat:';
        elem = document.createElement('ul');
        for (i = 0; i < state.users.length; i++) {
            option = document.createElement('li');
            option.appendChild(document.createTextNode(state.users[i]));
            elem.appendChild(option);
        }
        $('users-online').appendChild(elem);
    }

    function updatePoll() {
        var i, elem, name, option, btn, poll = state.poll;

        if (poll) {
            $('poll').className = '';
            $('poll').innerHTML = '';
            elem = document.createElement('h2');
            elem.appendChild(document.createTextNode('Poll: ' + poll.title));
            $('poll').appendChild(elem);
            elem = document.createElement('ul');
            for (name in poll.options) {
                if (poll.options.hasOwnProperty(name)) {
                    option = document.createElement('li');
                    if (pollVote === null && chatNick !== null) {
                        btn = document.createElement('button');
                        btn.appendChild(document.createTextNode(name));
                        (function (name) {
                            btn.onclick = function () {
                                send({
                                    type: 'vote',
                                    option: name
                                });
                                pollVote = name;
                                updatePoll();
                            };
                        }(name));
                        option.appendChild(btn);
                    } else {
                        option.appendChild(document.createTextNode((pollVote === name ? '▶ ' : '') + name));
                    }
                    option.appendChild(document.createTextNode(' (' + poll.options[name].length + ' votes - ' + poll.options[name].join(', ') + ')'));
                    elem.appendChild(option);
                }
            }
            $('poll').appendChild(elem);
        } else {
            $('poll').className = 'unloaded';
        }
    }

    function getVideoID(url) {
        var pos, pos2;

        if (url.substr(0, 7) === 'http://') {
            url = url.substr(7);
        } else if (url.substr(0, 8) === 'https://') {
            url = url.substr(8);
        } else {
            return false;
        }
        if (url.substr(0, 4) === 'www.') {
            url = url.substr(4);
        }
        if (url.substr(0, 9) === 'youtu.be/') {
            return url.substr(9);
        } else if (url.substr(0, 18) === 'youtube.com/watch?') {
            url = url.substr(18);
            pos = url.indexOf('v=');
            if (pos !== -1) {
                url = url.substr(pos + 2);
                pos2 = url.indexOf('&');
                if (pos2 === -1) {
                    return url;
                } else {
                    return url.substr(0, pos2);
                }
            } else {
                return false;
            }
        }
    }
}());
