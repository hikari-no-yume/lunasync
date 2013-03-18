var fs = require('fs'),
    https = require('https');

var Constants = require('./constants.js');

// internal variables and functions
var accountEmails = {}, accounts = {};

function loadAccounts() {
    if (fs.existsSync('accounts.json')) {
        var file = fs.readFileSync('accounts.json');
        var data = JSON.parse(file);
        accountEmails = data.accountEmails;
        accounts = data.accounts;
    }
}

function saveAccounts() {
    fs.writeFileSync('accounts.json', JSON.stringify({
        accounts: accounts,
        accountEmails: accountEmails
    }));
    console.log('Saved accounts');
}

var Accounts = {
    // do a persona assertion
    personaAssert: function (assertion, callback) {
        var postdata;

        if (Constants.DEBUG_MODE) {
            postdata = 'assertion=' + assertion + '&audience=' + Constants.DEBUG_ORIGIN;
        } else {
            postdata = 'assertion=' + assertion + '&audience=' + Constants.DEFAULT_ORIGIN;
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
    },
    // checks if we have a given email address
    haveEmail: function (email) {
        return accountEmails.hasOwnProperty(email);
    },
    // checks if we have a given nick
    haveNick: function (nick) {
        nick = nick.toLowerCase();
        return accounts.hasOwnProperty(nick);
    },
    // gets the nick associated with an email address
    getNick: function (email) {
        if (!this.haveEmail(email)) {
            throw new Error('No such email: ' + email);
        }
        return accountEmails[email];
    },
    // gets an account by email address
    getByEmail: function (email) {
        if (!this.haveEmail(email)) {
            throw new Error('No such email: ' + email);
        }
        return this.getByNick(this.getNick(email));
    },
    // gets an account by nick
    getByNick: function (nick) {
        nick = nick.toLowerCase();
        if (!this.haveNick(nick)) {
            throw new Error('No such account nick: ' + nick);
        }
        return accounts[nick];
    },
    // adds an account
    add: function (email, nick) {
        if (this.haveEmail(email)) {
            throw new Error('Already account with email: ' + email);
        }
        if (this.haveNick(email)) {
            throw new Error('Already account with nick: ' + nick);
        }
        accountEmails[email] = nick.toLowerCase();
        accounts[nick.toLowerCase()] = {
            email: email,
            nick: nick
        };
        saveAccounts();
    }
};

loadAccounts();

module.exports = Accounts;
