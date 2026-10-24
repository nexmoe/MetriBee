// Console formatting for the web server: time, level, tag, message, in color on a TTY.
// Existing `console.log('[tag] msg')` calls are picked up as-is; no call site changes needed.
// Colors follow NO_COLOR / FORCE_COLOR and switch off when output is piped (pm2, Docker logs).
const { styleText, format } = require('node:util');

const paint = (style, text, stream = process.stdout) => styleText(style, String(text), { stream });

const LEVELS = {
	log: { label: 'info ', style: 'blue', stream: process.stdout },
	info: { label: 'info ', style: 'blue', stream: process.stdout },
	warn: { label: 'warn ', style: 'yellow', stream: process.stderr },
	error: { label: 'error', style: 'red', stream: process.stderr },
};

const time = () => new Date().toTimeString().slice(0, 8);

function line(level, tag, msg) {
	const { label, style, stream } = LEVELS[level];
	const parts = [
		paint('gray', time(), stream),
		paint(['bold', style], label, stream),
		paint('cyan', (tag || 'app').padEnd(10), stream),
		level === 'log' || level === 'info' ? msg : paint(style, msg, stream),
	];
	stream.write(parts.join('  ') + '\n');
}

for (const level of Object.keys(LEVELS)) {
	console[level] = (...args) => {
		const text = format(...args).trim();
		if (!text) return;
		const m = text.match(/^\[([\w-]+)\]:?\s*([\s\S]*)$/);
		line(level, m?.[1], m ? m[2] : text);
	};
}

const STATUS_STYLE = (s) => (s >= 500 ? 'red' : s >= 400 ? 'yellow' : s >= 300 ? 'cyan' : 'green');

// Request log, problems only: any 5xx, and /api/* calls slower than SLOW_MS. Static files never reach it.
const SLOW_MS = 3000;
function problems(req, res, next) {
	const start = process.hrtime.bigint();
	res.on('finish', () => {
		// Time held at the boot gate is not the route being slow.
		const ms = Number(process.hrtime.bigint() - start) / 1e6 - (req.bootWaitMs || 0);
		const slow = ms > SLOW_MS && req.path.startsWith('/api/');
		if (res.statusCode < 500 && !slow) return;
		const msg = [
			paint('bold', req.method.padEnd(5)),
			paint(STATUS_STYLE(res.statusCode), res.statusCode),
			req.originalUrl,
			paint(slow ? 'yellow' : 'gray', `${ms.toFixed(0)} ms`),
		].join(' ');
		line(res.statusCode >= 500 ? 'error' : 'warn', 'http', msg);
	});
	next();
}

// Startup block: name, version, mode, then the useful links.
function banner({ name, version, url, mode, links, notes = [] }) {
	const out = process.stdout;
	const w = Math.max(...links.map(([k]) => k.length));
	out.write('\n');
	out.write(`  ${paint(['bold', 'blue'], name)} ${paint('gray', `v${version}`)}  ${paint(mode.style, mode.label)}\n\n`);
	for (const [label, path] of links) {
		out.write(`  ${paint('gray', '›')} ${label.padEnd(w)}  ${paint('cyan', url + path)}\n`);
	}
	for (const n of notes) out.write(`\n  ${paint('yellow', '!')} ${n}`);
	out.write(notes.length ? '\n\n' : '\n');
}

module.exports = { problems, banner, SLOW_MS };
