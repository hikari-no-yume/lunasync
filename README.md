What's lunasync?
================

synctube died so I made lunasync! It uses node.js.

Setup
-----

1. `npm install`

2. Set up a web server that serves `index.html` for its 404 page... my code shouldn't rely on this, but it does.

3. Run `server.js` on the same hostname. You'll need to change the code of both `lunasync.js` and `server.js` if that hostname isn't `lunasync.ajf.me`, it's hard-coded, sorry.

4. That's it, I think?
