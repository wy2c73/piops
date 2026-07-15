// Bridges a browser-side xterm.js terminal to a real interactive SSH shell
// on the target Pi. Protocol over the websocket is small JSON messages:
//   client -> server: {type:"input", data} | {type:"resize", cols, rows}
//   server -> client: {type:"output", data} | {type:"error", message} | {type:"closed"}

const { connect } = require('./lib/ssh');
const store = require('./lib/store');

function attach(wss) {
  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const deviceId = url.searchParams.get('id');
    const device = deviceId && store.getWithSecret(deviceId);

    if (!device) {
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown device' }));
      return ws.close();
    }

    let conn;
    let shellStream;
    try {
      conn = await connect(device);
      shellStream = await new Promise((resolve, reject) => {
        conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
          if (err) return reject(err);
          resolve(stream);
        });
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: `Could not open shell: ${err.message}` }));
      return ws.close();
    }

    shellStream.on('data', (data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: data.toString('utf8') }));
    });
    shellStream.stderr?.on('data', (data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: data.toString('utf8') }));
    });
    shellStream.on('close', () => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'closed' }));
      ws.close();
      conn.end();
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === 'input') {
        shellStream.write(msg.data);
      } else if (msg.type === 'resize') {
        shellStream.setWindow(msg.rows, msg.cols, 0, 0);
      }
    });

    ws.on('close', () => {
      shellStream.end();
      conn.end();
    });
  });
}

module.exports = { attach };
