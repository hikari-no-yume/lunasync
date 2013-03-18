module.exports = {
    DEBUG_MODE: process.argv.hasOwnProperty('2') && process.argv[2] === '--debug',
    DEFAULT_ORIGIN: 'http://lunasync.ajf.me',
    DEBUG_ORIGIN: 'http://localhost:8000'
};
