(function () {
    'use strict';

    var API_SERVER = window.location.hostname + ':9003',
        SITE_URL = 'http://lunasync.ajf.me';

    var mode, socket, ytPlayer, ytReady = false, twitchReady = false, currentPlayerType = '', errored = false, inFocus = true, ytEventQueue = [];

    var state = {
        playing: false,
        current: null,
        playlist: [],
        poll: null,
        users: {},
        viewers: 0
    }, haveControl = false, pollVote = null, chatNick = null;

    function $(id) {
        return document.getElementById(id);
    }

    window.onfocus = function () {
        inFocus = true;
    };

    window.onblur = function () {
        inFocus = false;
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

    function initYt() {
        ytReady = twitchReady = false;
        currentPlayerType = 'youtube';
        $('player').innerHTML = '<div id=yt-player></div>';

        window.onYouTubePlayerReady = function () {
            var event;

            ytReady = true;
            ytPlayer = $('yt-player');

            window.onStateChange = function (pstate) {
                var cueIndex;

                // if we are controlling
                if (haveControl) {
                    // if video paused and it was playing according to known state
                    if (pstate === 2 /* YT.PlayerState.PAUSED */ && state.playing) {
                        // broadcast state change
                        send({
                            type: 'stop',
                            time: ytPlayer.getCurrentTime()
                        });
                        state.playing = false;
                    // if video started playing and it was paused according to known state
                    } else if (pstate === 1 /*YT.PlayerState.PLAYING*/ && !state.playing) {
                        // broadcast state change
                        send({
                            type: 'play',
                            time: ytPlayer.getCurrentTime()
                        });
                        state.playing = true;
                    // if the video ended
                    } else if (pstate === 0 /*YT.PlayerState.ENDED*/) {
                        // if we're shuffling
                        if (state.shuffle) {
                            cueIndex = Math.floor(Math.random() * state.playlist.length);
                        // in order (normal)
                        } else {
                            // if we haven't reached the end of the playlist
                            if (state.current + 1 < state.playlist.length) {
                                // cue next video
                                cueIndex = state.current + 1;
                            } else {
                                // cue first video
                                cueIndex = 0;
                            }
                        }

                        send({
                            type: 'cue',
                            current: cueIndex
                        });
                    }
                }
            };
            ytPlayer.addEventListener('onStateChange', 'onStateChange');

            // clear queued events
            while (event = ytEventQueue.pop()) {
                executeYtEvent(event);
            }
        };

        swfobject.embedSWF("http://www.youtube.com/v/hCVGg1YDGhw?enablejsapi=1&version=3", "yt-player", "788", "480", "8", null, null, {
            allowScriptAccess: 'always'
        });
    }

    function initTwitch(id) {
        ytReady = twitchReady = false;
        currentPlayerType = 'twitch';
        $('player').innerHTML = '<div id=twitch-player></div>';

        swfobject.embedSWF("http://www.twitch.tv/widgets/live_embed_player.swf?channel=" + id, "twitch-player", "788", "480", "8", null, {
            hostname: 'www.twitch.tv',
            channel: id,
            auto_play: 'true',
            start_volume: '25'
        }, {
            allowFullScreen: 'true',
            allowNetworking: 'all',
            allowScriptAccess: 'always'
        });
    }

    // execute a YouTube player event
    function executeYtEvent(event) {
        ytPlayer[event[0]].apply(ytPlayer, event.slice(1));
    }

    // queue YouTube player event if not initialised
    function doYtEvent(event) {
        if (ytReady) {
            executeYtEvent(event);
        } else {
            ytEventQueue.push(event);
        }
    }

    // cue the video that matches the state
    function doCueCurrentVideo(initialTime) {
        var video, event;

        // check we have a video to play
        if (state.current !== null && state.playlist.length && state.playlist[state.current]) {
            video = state.playlist[state.current];

            video.type = video.type || 'youtube';

            // switch to right player type if incorrect
            if (currentPlayerType !== video.type) {
                switch (video.type) {
                    case 'youtube':
                        initYt();
                    break;
                    case 'twitch':
                        initTwitch(video.id);
                    break;
                }
            }       

            // in YouTube's case, we need to cue video specifically after init
            if (video.type === 'youtube') {
                event = [];
                if (state.playing) {
                    event.push('loadVideoById');
                } else {
                    event.push('cueVideoById');
                }
                event.push(state.playlist[state.current].id);
                if (initialTime) {
                    event.push(initialTime);
                }
                doYtEvent(event);
            }
        }
    }

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

    function appendTextAutoFormat(parent, text) {
        var pos, pos2, anchor, spoiler;
        while (text) {
            if ((pos = text.indexOf('http://')) !== -1 || (pos = text.indexOf('https://')) !== -1) {
                pos2 = text.indexOf(' ', pos);
                anchor = document.createElement('a');
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
            } else if ((pos = text.indexOf('[spoiler]')) !== -1 && (pos2 = text.indexOf('[/spoiler]', pos)) !== -1) {
                spoiler = document.createElement('span');
                spoiler.className = 'chat-spoiler';
                appendText(parent, text.substr(0, pos));
                appendText(spoiler, text.substr(pos + 9, pos2 - (pos + 9)));
                parent.appendChild(spoiler);
                text = text.substr(pos2 + 10);
            } else {
                appendText(parent, text);
                text = '';
            }
        }
    }

    function send(msg) {
        socket.send(JSON.stringify(msg));
    }

    function scrollChatlog() {
        $('chatlog').scrollTop = $('chatlog').scrollHeight;
    }

    // homepage
    function initHome() {
        // do nothing, default page state is homepage
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

    // sync viewing page
    function initView(id, control) {
        var url;

        // replace homepage with loading message
        $('homepage').innerHTML = 'Connecting...';

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
            var msg, stream, elem, elem2, elem3, nick;

            msg = JSON.parse(event.data);

            switch (msg.type) {
                case 'stream_info':
                    // replace homepage with viewing page template
                    $('homepage').outerHTML = '<div id=viewpage>' + $('viewpage-template').innerHTML + '</div>';
                
                    stream = msg.stream;

                    // display stream title
                    $('title').innerHTML = '';
                    $('title').appendChild(document.createTextNode(stream.title));
                    $('titlebox').value = stream.title;
                    document.title = stream.title + ' - lunasync';

                    // display stream viewing URL
                    $('view-link').value = SITE_URL + '/' + stream.id;

                    // update state
                    state.playing = stream.playing;
                    state.current = stream.current;
                    state.playlist = stream.playlist;
                    state.poll = stream.poll;
                    state.viewers = stream.viewers;
                    state.shuffle = stream.shuffle;

                    // display playlist
                    updatePlaylist();

                    // display poll
                    updatePoll();

                    // display user count
                    updateUsersOnline();

                    // display shuffle status
                    $('shuffle').checked = state.shuffle;

                    // cue and play correct video
                    doCueCurrentVideo(stream.time);

                    // if we have control of the stream
                    if (msg.control) {
                        haveControl = true;

                        // allow changing title
                        $('titlebox').disabled = false;
                        $('titlebox').onchange = function () {
                            send({
                                type: 'change_title',
                                title: $('titlebox').value
                            });
                            document.title = $('titlebox').value + ' - lunasync';
                            $('title').innerHTML = '';
                            $('title').appendChild(document.createTextNode($('titlebox').value));
                        };

                        // unhide control box
                        $('control').className = '';

                        // display stream control URL
                        $('control-link').value = SITE_URL + '/' + stream.id + '#control=' + control;

                        // enable stream controls
                        $('shuffle').disabled = false;
                        $('shuffle').onchange = function () {
                            send({
                                type: 'change_shuffle',
                                shuffle: $('shuffle').checked
                            });
                            state.shuffle = $('shuffle').checked;
                        };

                        $('rm-button').disabled = false;
                        $('rm-button').onclick = function () {
                            var i, items = selectedOptions($('playlist')), oldCurrent, newCurrent, cue = false;

                            oldCurrent = newCurrent = state.playlist[state.current];

                            // remove selected playlist items
                            for (i = 0; i < items.length; i++) {
                                // currently playing video being deleted
                                if (state.playlist[items[i].dataLSindex] === newCurrent) {
                                    console.log('state.playlist[items[i].dataLSindex] === newCurrent');
                                    // go to next, if possible
                                    if (items[i].dataLSindex + 1 < state.playlist.length) {
                                        newCurrent = state.playlist[items[i].dataLSindex + 1];
                                        console.log('went to next, +1');
                                    // otherwise loop around, if possible
                                    } else if (state.playlist.length) {
                                        newCurrent = state.playlist[0];
                                        console.log('looped around');
                                    // otherwise stop
                                    } else {
                                        newCurrent = null;
                                        console.log('nulled');
                                    }
                                }
                                state.playlist.splice(items[i].dataLSindex, 1);
                            }

                            // check if there is anything to play
                            if (newCurrent !== null) {
                                console.log('newCurrent !== null');
                                // update the state
                                state.current = state.playlist.indexOf(newCurrent);

                                // now playing a different video than before
                                if (newCurrent !== oldCurrent) {
                                    console.log('newCurrent !== oldCurrent');
                                    // cue that new video
                                    cue = state.current;
                                }
                            } else {
                                console.log('newCurrent === null');
                                // cue nothing (stop)
                                cue = null;
                            }

                            updatePlaylist();

                            // push update to server by overwriting playlist
                            // (this may create race conditions...)
                            send({
                                type: 'update_playlist',
                                playlist: state.playlist,
                                current: state.current
                            });

                            if (cue !== false) {
                                console.log('cue !== false');
                                send({
                                    type: 'cue',
                                    current: cue
                                });
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
                        $('move-up-btn').onclick = function (e) {
                            var i, items = selectedOptions($('playlist')), item;

                            // move selected playlist items up
                            for (i = 0; i < items.length; i++) {
                                if (items[i].dataLSindex - 1 >= 0) {
                                    item = state.playlist.splice(items[i].dataLSindex, 1);
                                    state.playlist.splice(items[i].dataLSindex - 1, 0, item[0]);
                                    // current video index pointed to this item
                                    if (state.current === items[i].dataLSindex) {
                                        state.current--;
                                    }
                                    updatePlaylist(items[i].index - 1);
                                }
                            }

                            // push update to server by overwriting playlist
                            // (this may create race conditions...)
                            send({
                                type: 'update_playlist',
                                playlist: state.playlist,
                                current: state.current
                            });

                            // prevent change of focus
                            e.preventDefault();
                            return false;
                        };

                        $('move-down-btn').disabled = false;
                        $('move-down-btn').onclick = function (e) {
                            var i, items = selectedOptions($('playlist')), item;

                            // move selected playlist items up
                            for (i = 0; i < items.length; i++) {
                                if (items[i].dataLSindex + 1 < state.playlist.length) {
                                    item = state.playlist.splice(items[i].dataLSindex, 1);
                                    state.playlist.splice(items[i].dataLSindex + 1, 0, item[0]);
                                    // current video index pointed to this item
                                    if (state.current === items[i].dataLSindex) {
                                        state.current++;
                                    }
                                    updatePlaylist(items[i].index + 1);
                                }
                            }

                            // push update to server by overwriting playlist
                            // (this may create race conditions...)
                            send({
                                type: 'update_playlist',
                                playlist: state.playlist,
                                current: state.current
                            });

                            // prevent change of focus
                            e.preventDefault();
                            return false;
                        };

                        $('add-url').disabled = false;
                        $('add-url').onkeypress = function (e) {
                            var videoData;

                            // enter
                            if (e.which === 13) {
                                e.preventDefault();
                                $('add-url').blur();
                                videoData = getVideoData($('add-url').value);
                                if (videoData !== false) {
                                    send({
                                        type: 'add_url',
                                        videotype: videoData.type,
                                        id: videoData.id
                                    });
                                    $('add-url').value = '';
                                } else {
                                    alert($('add-url').value + ' is not a valid URL for YouTube or Twitch!');
                                }
                                return false;
                            }
                        };
                        $('add-url').onkeyup = function (e) {
                            var videoData, i, re;

                            if ($('add-url').value) {
                                // search for ID match if it looks like a URL
                                videoData = getVideoData($('add-url').value)
                                if (videoData) {
                                    for (i = 0; i < state.playlist.length; i++) {
                                        if (state.playlist[i].id === videoData.id) {
                                            $('playlist').selectedIndex = i;
                                            break;
                                        }
                                    }
                                // otherwise do regex search
                                } else {
                                    re = new RegExp($('add-url').value, 'gi');
                                    for (i = 0; i < state.playlist.length; i++) {
                                        if (state.playlist[i].title.match(re)) {
                                            $('playlist').selectedIndex = i;
                                            break;
                                        }
                                    }
                                }
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
                    updatePlaylist($('playlist').selectedIndex);
                break;
                case 'change_title':
                    $('titlebox').value = msg.title;
                    $('title').innerHTML = '';
                    $('title').appendChild(document.createTextNode(msg.title));
                    document.title = msg.title + ' - lunasync';
                    elem = document.createElement('div');
                    elem.className = 'chat-mute';
                    elem.appendChild(document.createTextNode('* Title was changed to "' + msg.title + '"' + (msg.by ? (' by ' + msg.by) : '')));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                break;
                case 'change_shuffle':
                    $('shuffle').checked = msg.shuffle;
                break;
                case 'cue':
                    state.playing = true;
                    state.current = msg.current;
                    doCueCurrentVideo();
                    updatePlaylist();
                break;
                case 'play':
                    if (currentPlayerType === 'youtube') {
                        state.playing = true;
                        doYtEvent(['seekTo', msg.time, true]);
                        doYtEvent([]);
                    }
                break;
                case 'stop':
                    if (currentPlayerType === 'youtube') {
                        state.playing = false;
                        doYtEvent(['seekTo', msg.time, true]);
                        doYtEvent(['pauseVideo']);
                    }
                break;
                case 'join':
                    elem = document.createElement('div');
                    elem.className = 'chat-join';
                    elem.appendChild(document.createTextNode('* ' + msg.prefix + msg.nick + ' joined chat'));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    state.users[msg.nick] = {
                        prefix: msg.prefix
                    };
                    updateUsersOnline();
                break;
                case 'leave':
                    elem = document.createElement('div');
                    elem.className = 'chat-leave';
                    elem.appendChild(document.createTextNode('* ' + msg.prefix + msg.nick + ' left chat'));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    delete state.users[msg.nick];
                    updateUsersOnline();
                break;
                case 'mute':
                    elem = document.createElement('div');
                    elem.className = 'chat-mute';
                    elem.appendChild(document.createTextNode('* ' + msg.nick + ' was muted by ' + msg.by));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    state.users[msg.nick].prefix = '~';
                    if (chatNick === msg.nick) {
                        $('chatbox').disabled = true;
                    }
                    updateUsersOnline();
                break;
                case 'unmute':
                    elem = document.createElement('div');
                    elem.className = 'chat-mute';
                    elem.appendChild(document.createTextNode('* ~' + msg.nick + ' was unmuted by ' + msg.by));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    state.users[msg.nick].prefix = msg.prefix;
                    if (chatNick === msg.nick) {
                        $('chatbox').disabled = false;
                    }
                    updateUsersOnline();
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
                case 'action':
                    elem = document.createElement('div');
                    elem2 = document.createElement('span');
                    elem2.className = 'chat-nick';
                    elem2.appendChild(document.createTextNode(msg.nick));
                    if (msg.type === 'action') {
                        elem.appendChild(document.createTextNode('* '));
                        elem.className = 'chat-action';
                    }
                    elem.appendChild(elem2);
                    if (msg.type === 'msg') {
                        elem.appendChild(document.createTextNode(': '));
                    } else {
                        elem.appendChild(document.createTextNode(' '));
                    }
                    if (msg.msg[0] === '>') {
                        elem3 = document.createElement('span');
                        elem3.className = 'chat-greentext';
                        appendTextAutoFormat(elem3, msg.msg);
                        elem.appendChild(elem3);
                    } else {
                        appendTextAutoFormat(elem, msg.msg);
                    }
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
                    // disable chatbox if muted, else enable
                    $('chatbox').disabled = (msg.prefix === '~');
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
                        init404();
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
        // replace homepage with 404 message
        $('homepage').innerHTML = '404 - luna not found. This page either never existed or no longer existed, are you sure you typed the URL right?';
    }

    function updatePlaylist(selectedIndex) {
        var i, option, text;;

        $('playlist').innerHTML = '';
        for (i = 0; i < state.playlist.length; i++) {
            option = document.createElement('option');
            text = '[' + (state.playlist[i].views || 0) + '] ';
            text += state.playlist[i].title;
            if (state.current === i) {
                text = '▶ ' + text;
                option.className = 'now-playing';
            }

            option.appendChild(document.createTextNode(text));
            option.dataLSindex = i;
            $('playlist').appendChild(option);
        }

        $('video-count').innerHTML = '';
        $('video-count').appendChild(document.createTextNode('(' + state.playlist.length + ' videos)'));

        if (selectedIndex !== undefined) {
            $('playlist').selectedIndex = selectedIndex;
        }
    }


    function updateUsersOnline() {
        var i, elem, userKeys;

        // sort nicks case-insensitively inclusive of prefix
        userKeys = _.keys(state.users).sort(function (a, b) {
            a = state.users[a].prefix + a.toLowerCase();
            b = state.users[b].prefix + b.toLowerCase();
            if (a < b) {
                return -1;
            } else if (a > b) {
                return 1;
            }
            return 0;
        });
        $('users-online').innerHTML = _.size(state.users) + '/' + state.viewers + ' viewers in chat:';
        elem = document.createElement('ul');
        _.each(userKeys, function (nick) {
            var option, user = state.users[nick];

            option = document.createElement('li');
            if (user.prefix === '@') {
                option.className = 'user-op';
            } else if (user.prefix === '~') {
                option.className = 'user-muted';
            }
            option.appendChild(document.createTextNode(user.prefix + nick));
            elem.appendChild(option);
        });
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

    function getYouTubeVideoID(url) {
        var pos, pos2;

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
    function getTwitchVideoID(url) {
	    if (url.substr(0,10) === 'twitch.tv/') {
            return url.substr(10);
        } else {
            return false;
        }
    }
    function getVideoData(url) {
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
	    if (getYouTubeVideoID(url)) {
            return {
                type: 'youtube',
                id: getYouTubeVideoID(url)
            };
        } else if (getTwitchVideoID(url)) {
            return {
                type: 'twitch',
                id: getTwitchVideoID(url)
            };
        } else {
            return false;
        }
    }
}());
