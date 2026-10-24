// ecosystem.config.js
module.exports = {
    apps: [
        {
            name: "pulseboard", // process name in pm2 list
            script: "portless", // the binary
            args: "run pnpm dev", // args passed to it
            interpreter: "none", // treat as a raw binary, not node script
            watch: false,
        },
    ],
};
