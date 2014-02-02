What's lunasync?
================

synctube died so I made lunasync! It uses node.js and WebSocket.

Currently live at [lunasync.ajf.me](http://lunasync.ajf.me/).

Setup
-----

1. `npm install`

2. Configure `server/config.json`. Unless you're ajf, keep `useInternalServer` as `true`. Set `debugOrigin` and `origin` to the hostnames of the places you'll be hosting lunasync on. Here's a default config.json:
   
        {
           "useInternalServer": true,
           "debugOrigin": "http://localhost:8000",
           "origin": "http://lunasync.ajf.me"
        }

3. Run `node server.js` on the same hostname. (Add the `--debug` flag when debugging to ignore request origins).

4. That's it, I think?

Notes
-----

If you type the letter `u` when running the server, it will kick all the clients off for updating and shut down. The clients should reconnect after 5 seconds.
