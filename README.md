What's lunasync?
================

synctube died so I made lunasync! It uses node.js and WebSocket.

Currently live at [lunasync.ajf.me](http://lunasync.ajf.me/).

Setup
-----

1. `npm install`

2. Set up a web server that serves `index.html` for its 404 page... my code shouldn't rely on this, but it does.

3. Run `node server.js` on the same hostname. (Add the `--debug` flag when debugging to ignore request origins). For production use you'll need to change the code of both `lunasync.js` and `server.js` if that hostname isn't `lunasync.ajf.me`, it's hard-coded, sorry. However when debugging, it will just try to contact the WebSocket server from the same domain (e.g. if web server is on `localhost:8000` it will try to contact WS server on `localhost:9003`).

4. That's it, I think?
