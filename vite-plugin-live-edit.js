// Vite plugin: live-edit slides from the browser back to index.html
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export default function liveEdit() {
  const htmlPath = resolve('index.html');
  let skipNextReload = false;

  return {
    name: 'vite-plugin-live-edit',
    handleHotUpdate({ file }) {
      // Suppress HMR reload when we just wrote the file ourselves
      if (file === htmlPath && skipNextReload) {
        skipNextReload = false;
        return []; // empty array = no modules to update = no reload
      }
    },
    configureServer(server) {
      // API endpoint to receive edits
      server.middlewares.use('/api/live-edit', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { oldText, newText, plainOld, plainNew } = JSON.parse(body);

            const html = readFileSync(htmlPath, 'utf-8');

            // Mode 1: source HTML match with plain text replacement
            if (plainOld && plainNew && oldText) {
              const srcHtml = oldText.trim();
              const idx = html.indexOf(srcHtml);
              if (idx === -1) {
                console.log('[live-edit] Source HTML not found:', srcHtml.slice(0, 80) + '...');
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: false, reason: 'src not found' }));
                return;
              }

              // Find the plain text within the source HTML and replace it
              // Strategy: find plainOld in srcHtml (stripping tags), replace in source
              // Simple approach: just find/replace the plain text portions
              let newSrc = srcHtml;
              // Find plainOld as a substring in the tag-stripped version
              const stripped = srcHtml.replace(/<[^>]*>/g, '');
              if (stripped.includes(plainOld)) {
                // Direct text replacement within the source, preserving HTML tags
                // Find where plainOld differs from plainNew
                newSrc = srcHtml.replace(plainOld, plainNew);
              } else {
                // Fallback: just replace in the full source
                newSrc = srcHtml.replace(stripped.trim(), plainNew);
              }

              const updated = html.slice(0, idx) + newSrc + html.slice(idx + srcHtml.length);
              skipNextReload = true;
              writeFileSync(htmlPath, updated, 'utf-8');
              console.log('[live-edit] Saved plain text change');
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true, newSrc: newSrc }));
              return;
            }

            // Mode 2: direct HTML match (legacy)
            if (!oldText || !newText || oldText === newText) {
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true, skipped: true }));
              return;
            }

            const searchOld = oldText.trim();
            const idx = html.indexOf(searchOld);
            if (idx === -1) {
              console.log('[live-edit] NOT FOUND in file. Looking for:', searchOld.slice(0, 80) + '...');
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: false, reason: 'not found' }));
              return;
            }

            const updated = html.slice(0, idx) + newText.trim() + html.slice(idx + searchOld.length);
            skipNextReload = true;
            writeFileSync(htmlPath, updated, 'utf-8');
            console.log('[live-edit] Saved direct change at index', idx);

            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },

    transformIndexHtml(html) {
      // Inject the client-side script in dev mode
      const script = `
<script>
(function() {
  // Make text elements editable — toggle with Ctrl+E / Cmd+E
  const selectors = '.math-body p, .math-body li, .body-text, .chart-title, .chart-subtitle, .chart-notes, h1, h2, h3';
  let editMode = true;

  // Snapshot original source HTML before MathJax transforms it
  document.querySelectorAll(selectors).forEach(el => {
    el.dataset.srcHtml = el.innerHTML;
  });

  function setEditable(on) {
    document.querySelectorAll(selectors).forEach(el => {
      if (el.closest('.slide-title-card') && el.tagName === 'H1') return;
      el.contentEditable = on ? 'true' : 'false';
      el.style.cursor = on ? 'text' : '';
      el.spellcheck = false;
    });
  }

  function setupEditable() { setEditable(editMode); }

  // Toggle edit mode with Cmd/Ctrl+E
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
      e.preventDefault();
      editMode = !editMode;
      setEditable(editMode);
      console.log('[live-edit] Edit mode:', editMode ? 'ON' : 'OFF');
    }
  });

  // Cmd/Ctrl+S to force-save current edit
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (activeEl && activeEl.contentEditable === 'true') {
        clearTimeout(saveTimer);
        saveChange(activeEl);
        activeEl.style.transition = 'background 0.3s';
        activeEl.style.background = 'rgba(90,138,94,0.15)';
        setTimeout(() => { activeEl.style.background = ''; }, 600);
        console.log('[live-edit] Saved.');
      }
    }
  });

  // Block Enter from creating divs
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.contentEditable === 'true') {
      e.preventDefault();
      document.execCommand('insertText', false, ' ');
    }
  });

  // Escape blurs the current element
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.contentEditable === 'true') {
      e.target.blur();
    }
  });

  // Track edits
  let saveTimer = null;
  let activeEl = null;

  function cleanText(html) {
    return html
      .replace(new RegExp('<div>', 'gi'), ' ')
      .replace(new RegExp('<' + '/div>', 'gi'), '')
      .replace(/&nbsp;/g, ' ')
      .replace(/  +/g, ' ');
  }

  // Extract plain text + inline HTML (strip MathJax rendered output, keep $...$)
  function getEditableText(el) {
    // Walk child nodes: keep text and simple tags, skip mjx-container (replace with original source)
    let result = '';
    el.childNodes.forEach(node => {
      if (node.nodeType === 3) { // text node
        result += node.textContent;
      } else if (node.tagName === 'MJX-CONTAINER') {
        // Try to recover original LaTeX from aria-label or skip
        const ariaLabel = node.getAttribute('aria-label');
        // The source is lost after MathJax, so we can't recover it here
        result += node.textContent || '';
      } else if (node.tagName === 'CITE') {
        result += node.outerHTML;
      } else {
        result += node.outerHTML;
      }
    });
    return cleanText(result);
  }

  function saveChange(el) {
    const srcHtml = el.dataset.srcHtml;
    if (!srcHtml) return;
    // Build new text: take the current textContent approach
    // Since MathJax makes innerHTML unusable, use textContent for the new version
    // and do a textContent-based find/replace on the source
    const newPlain = el.textContent.trim();
    const oldPlain = el.dataset.plainText;
    if (!oldPlain || newPlain === oldPlain) return;

    // Send source HTML as oldText (matches file), and ask server to do text replacement
    fetch('/api/live-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldText: srcHtml, newText: srcHtml, plainOld: oldPlain, plainNew: newPlain })
    }).then(r => r.json()).then(data => {
      if (data.ok) {
        el.dataset.srcHtml = data.newSrc || srcHtml;
        el.dataset.plainText = newPlain;
      }
      console.log('[live-edit] Response:', data);
    }).catch(err => { console.log('[live-edit] Error:', err); });
  }

  document.addEventListener('focusin', (e) => {
    if (e.target.contentEditable === 'true') {
      if (!e.target.dataset.plainText) {
        e.target.dataset.plainText = e.target.textContent.trim();
      }
      activeEl = e.target;
    }
  });

  // No auto-save on keystroke — use Cmd+S or blur instead

  // Also save on blur (immediate)
  document.addEventListener('focusout', (e) => {
    if (e.target.contentEditable !== 'true') return;
    clearTimeout(saveTimer);
    saveChange(e.target);
  });

  // Save before page unload
  window.addEventListener('beforeunload', () => {
    if (activeEl && activeEl.contentEditable === 'true') {
      saveChange(activeEl);
    }
  });

  // Set up after reveal initializes
  if (typeof Reveal !== 'undefined') {
    Reveal.on('ready', setupEditable);
    Reveal.on('slidechanged', setupEditable);
  }
  setTimeout(setupEditable, 1000);
})();
</script>`;
      return html.replace('</body>', script + '\n</body>');
    }
  };
}
