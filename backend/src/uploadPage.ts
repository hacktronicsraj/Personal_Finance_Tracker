/**
 * The flashcard upload page — a single self-contained HTML document served by the
 * Worker at GET /upload.
 *
 * Why a server-rendered string instead of a static asset: it keeps the deploy to
 * one Worker with no assets binding, and the page is small enough that a build
 * step would cost more than it saves.
 *
 * Security model: the page itself is public (a browser can't send a bearer
 * token), but every action it takes goes through POST /upload/bulk, which
 * checks UPLOAD_PASSWORD server-side. The API_TOKEN is never sent to the
 * browser.
 */
export const uploadPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flashcard Upload</title>
<style>
  :root {
    --bg: #09090b; --surface: #131316; --surface2: #1c1c21; --hairline: #27272a;
    --text: #fafafa; --muted: #a1a1aa; --ghost: #71717a;
    --accent: #34d399; --neg: #f87171; --amber: #fbbf24;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #fafafa; --surface: #ffffff; --surface2: #f4f4f5; --hairline: #e4e4e7;
      --text: #18181b; --muted: #52525b; --ghost: #a1a1aa;
      --accent: #059669; --neg: #dc2626; --amber: #b45309;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--text);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex; justify-content: center; padding: 32px 16px 64px;
  }
  .wrap { width: 100%; max-width: 640px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }
  .sub { color: var(--muted); font-size: 14px; margin: 0 0 28px; }
  .card {
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 16px; padding: 20px; margin-bottom: 16px;
  }
  label { display: block; font-size: 12px; font-weight: 600; letter-spacing: .06em;
    text-transform: uppercase; color: var(--ghost); margin-bottom: 7px; }
  input[type=password], input[type=text] {
    width: 100%; background: var(--surface2); border: 1px solid var(--hairline);
    border-radius: 10px; padding: 11px 13px; color: var(--text); font-size: 15px;
    font-family: inherit; outline: none;
  }
  input:focus { border-color: var(--accent); }
  .field { margin-bottom: 16px; }
  .field:last-child { margin-bottom: 0; }
  .drop {
    border: 1.5px dashed var(--hairline); border-radius: 12px; padding: 30px 16px;
    text-align: center; cursor: pointer; transition: border-color .15s, background .15s;
    background: var(--surface2);
  }
  .drop:hover, .drop.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface2)); }
  .drop strong { display: block; font-size: 15px; margin-bottom: 4px; }
  .drop span { color: var(--muted); font-size: 13px; }
  .file { display: none; margin-top: 12px; font-size: 13.5px; color: var(--accent); font-weight: 600; }
  .file.on { display: block; }
  button {
    width: 100%; border: 0; border-radius: 12px; padding: 13px; font-size: 15px;
    font-weight: 700; cursor: pointer; background: var(--accent); color: #04150e;
    font-family: inherit; margin-top: 18px; transition: opacity .15s;
  }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .hint { color: var(--ghost); font-size: 12.5px; margin-top: 14px; line-height: 1.6; }
  code { background: var(--surface2); padding: 1px 5px; border-radius: 4px;
    font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .out { display: none; }
  .out.on { display: block; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
  .stat { background: var(--surface2); border-radius: 10px; padding: 12px; text-align: center; }
  .stat b { display: block; font-size: 24px; font-weight: 800; line-height: 1.2; }
  .stat small { color: var(--ghost); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .err { color: var(--neg); }
  .ok { color: var(--accent); }
  .errlist { margin: 0; padding-left: 18px; color: var(--neg); font-size: 13px; }
  .errlist li { margin-bottom: 5px; }
  .msg { border-radius: 10px; padding: 11px 13px; font-size: 14px; margin-bottom: 14px; }
  .msg.bad { background: color-mix(in srgb, var(--neg) 14%, transparent); color: var(--neg); }
  .msg.good { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Flashcard upload</h1>
  <p class="sub">Import a CSV into your Anki-style deck. Duplicates are skipped automatically.</p>

  <div class="card">
    <div class="field">
      <label for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password" placeholder="Upload password">
    </div>

    <div class="field">
      <label>CSV file</label>
      <div class="drop" id="drop">
        <strong>Drop a .csv here</strong>
        <span>or click to choose a file</span>
      </div>
      <input id="file" type="file" accept=".csv,text/csv" style="display:none">
      <div class="file" id="fname"></div>
    </div>

    <div class="field">
      <label for="deck">Deck</label>
      <input id="deck" type="text" placeholder="inference" value="default">
    </div>

    <button id="go" disabled>Upload</button>
    <div class="hint">
      Columns: <code>question,option1,option2,option3,option4,answer[,difficulty]</code><br>
      <code>answer</code> is the 0-based index of the correct option (0&ndash;3).
    </div>
  </div>

  <div class="card out" id="out"></div>
</div>

<script>
(function () {
  var pw = document.getElementById('pw');
  var file = document.getElementById('file');
  var drop = document.getElementById('drop');
  var fname = document.getElementById('fname');
  var deck = document.getElementById('deck');
  var go = document.getElementById('go');
  var out = document.getElementById('out');
  var csvText = '';
  var busy = false;

  function refresh() {
    go.disabled = busy || !csvText || !pw.value;
  }

  function setFile(f) {
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      csvText = String(reader.result || '');
      fname.textContent = f.name + '  \\u00b7  ' + csvText.split('\\n').length + ' lines';
      fname.classList.add('on');
      refresh();
    };
    reader.readAsText(f);
  }

  drop.addEventListener('click', function () { file.click(); });
  file.addEventListener('change', function () { setFile(file.files[0]); });
  pw.addEventListener('input', refresh);

  ['dragenter', 'dragover'].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (ev) {
    if (ev.dataTransfer.files && ev.dataTransfer.files[0]) setFile(ev.dataTransfer.files[0]);
  });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render(ok, data) {
    out.classList.add('on');
    if (!ok) {
      out.innerHTML = '<div class="msg bad">' + esc(data.error || 'Upload failed') + '</div>';
      return;
    }
    var errs = data.errors || [];
    var html = '<div class="stats">' +
      '<div class="stat"><b class="ok">' + data.added + '</b><small>added</small></div>' +
      '<div class="stat"><b>' + data.skipped + '</b><small>skipped</small></div>' +
      '<div class="stat"><b>' + data.total + '</b><small>in deck</small></div>' +
      '</div>';
    if (!errs.length) {
      html += '<div class="msg good">Imported into <strong>' + esc(data.deck) + '</strong>.</div>';
    } else {
      html += '<div class="msg bad">' + errs.length + ' row(s) skipped:</div>' +
        '<ul class="errlist">' + errs.map(function (e) {
          return '<li>Line ' + e.line + ': ' + esc(e.reason) + '</li>';
        }).join('') + '</ul>';
    }
    out.innerHTML = html;
  }

  go.addEventListener('click', function () {
    if (busy) return;
    busy = true; refresh();
    go.textContent = 'Uploading\\u2026';
    fetch('/upload/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw.value, csv: csvText, deck: deck.value.trim() || 'default' })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); })
      .then(function (res) { render(res.ok, res.data); })
      .catch(function () { render(false, { error: 'Network error \\u2014 check your connection.' }); })
      .then(function () { busy = false; go.textContent = 'Upload'; refresh(); });
  });
})();
</script>
</body>
</html>`;
