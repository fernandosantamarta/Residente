// Makes the static admin mocks feel live: toasts on actions, segmented-tab
// switching, dropdown + copy feedback. Pure demo — nothing is persisted.
(function () {
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, 1900);
  }

  function onPlatform() { return /platform\.html$/.test(location.pathname); }

  document.addEventListener('click', function (e) {
    // Inside a modal? let the modal's own handlers manage it.
    if (e.target.closest('.modal-back')) return;

    // Close any open dropdown menu when clicking outside a dropdown.
    if (!e.target.closest('.dd')) closeMenus();

    // "View as" role switch
    var va = e.target.closest('.viewas button');
    if (va) { setView(va.getAttribute('data-view')); return; }

    // dropdown menu item picked
    var mi = e.target.closest('.ddmenu button');
    if (mi) {
      var ownerDd = mi.closest('.dd');
      if (ownerDd) ownerDd.childNodes[0].nodeValue = mi.textContent + ' ';
      closeMenus();
      return;
    }

    // segmented tabs — switch the active pill (+ panels if data-tab)
    var seg = e.target.closest('.seg button');
    if (seg) {
      Array.prototype.forEach.call(seg.parentElement.children, function (b) { b.classList.remove('on'); });
      seg.classList.add('on');
      var tab = seg.getAttribute('data-tab');
      if (tab) {
        var scope = seg.closest('main') || document;
        scope.querySelectorAll('[data-panel]').forEach(function (p) {
          p.style.display = (p.getAttribute('data-panel') === tab) ? '' : 'none';
        });
      } else {
        toast(seg.textContent.trim());
      }
      return;
    }

    // permission tiles (roles) — toggle the check
    var tile = e.target.closest('label.lrow');
    if (tile) {
      var dot = tile.querySelector('.dot');
      if (dot) {
        var on = dot.classList.toggle('checked');
        dot.style.background = on ? 'var(--accent)' : '#fff';
        dot.style.borderColor = on ? 'transparent' : 'var(--border-hover)';
        dot.style.color = '#fff';
        dot.innerHTML = on ? '&#10003;' : '&nbsp;';
      }
      return;
    }

    // dropdown — toggle a real menu
    var dd = e.target.closest('.dd');
    if (dd) {
      if (dd.classList.contains('open')) { closeMenus(); }
      else { closeMenus(); openMenu(dd); }
      return;
    }

    // buttons
    var btn = e.target.closest('.btn');
    if (btn) {
      if (btn.tagName === 'A' && btn.getAttribute('href') && btn.getAttribute('href') !== '#') return; // real link
      e.preventDefault();
      routeAction(btn, btn.textContent.trim());
      return;
    }

    // row "go" actions
    var go = e.target.closest('.go');
    if (go) {
      if (go.tagName === 'A' && go.getAttribute('href') && go.getAttribute('href') !== '#') return; // real link
      e.preventDefault();
      routeAction(go, go.textContent.trim());
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal(); closeMenus(); }
  });

  // --- action router ---------------------------------------------------------
  function routeAction(el, label) {
    var l = label.toLowerCase();
    if (/^copy$/.test(l)) {
      var prev = el.textContent; el.textContent = 'Copied ✓';
      setTimeout(function () { el.textContent = prev; }, 1500); return;
    }
    if (/manage/.test(l) && onPlatform() && el.closest('tr')) { return enterCommunity(el); }
    if (/repl(y|ies)/.test(l)) { return openReply(el); }
    if (/paste/.test(l)) { return openPaste(); }
    if (/upload|choose file|bulk|import/.test(l)) { return openUpload(cleanTitle(label)); }
    if (/invite/.test(l)) { return openForm('Invite', [['Email', 'their email'], ['Unit', 'e.g. 4B']], 'Send invite', 'Invitation sent ✓'); }
    if (/^\+|^add|^new|schedule|operator|category|household|event|rule|community/.test(l)) {
      return openForm(cleanTitle(label), [['Name', 'Type here…'], ['Details', 'Optional']], 'Add', cleanTitle(label).replace(/^add\s*/i, '') + ' added ✓');
    }
    if (/edit|open|view|details|resolve|start|reach out|email owner/.test(l)) { return openDetail(el, label); }
    if (/send/.test(l)) { return toast('Sent ✓'); }
    if (/export|download|poster/.test(l)) { return toast(/poster/.test(l) ? 'Poster downloaded ✓' : (/export/.test(l) ? 'Exported ✓' : 'Downloaded ✓')); }
    if (/save|subscribe|activate|confirm|continue|manage subscription|help center/.test(l)) { return toast(label.replace(/\s*&rarr;|→/, '').trim() + ' ✓'); }
    toast(label.replace(/^\+\s*/, '').replace(/→/, '').trim() + ' ✓');
  }

  function cleanTitle(label) { return label.replace(/^\+\s*/, '').replace(/→|&rarr;/g, '').trim(); }

  function enterCommunity(el) {
    var tr = el.closest('tr');
    var name = tr && tr.querySelector('.strong') ? tr.querySelector('.strong').textContent.trim() : 'community';
    toast('Entering ' + name + ' …');
    setTimeout(function () { location.href = 'index.html'; }, 550);
  }

  // --- dropdown menus --------------------------------------------------------
  function closeMenus() {
    document.querySelectorAll('.ddmenu').forEach(function (m) { m.remove(); });
    document.querySelectorAll('.dd.open').forEach(function (d) { d.classList.remove('open'); });
  }
  function openMenu(dd) {
    var opts = menuFor((dd.childNodes[0].nodeValue || '').trim().toLowerCase());
    var menu = document.createElement('div');
    menu.className = 'ddmenu';
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = o;
      menu.appendChild(b);
    });
    dd.appendChild(menu);
    dd.classList.add('open');
  }
  function menuFor(t) {
    if (/year|month|date|to date|period/.test(t)) return ['This month', 'Last month', 'This quarter', 'Year to date', 'All time'];
    if (/categor/.test(t)) return ['All categories', 'Income', 'Expenses', 'Reserves', 'Insurance'];
    if (/202\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/.test(t)) return ['April 2026', 'May 2026', 'June 2026', 'July 2026', 'August 2026'];
    if (/homeowner|condo|ch\./.test(t)) return ['Homeowners (Ch. 720)', 'Condo (Ch. 718)'];
    if (/founder|onboarding|support|billing/.test(t)) return ['Founder', 'Onboarding', 'Support', 'Billing'];
    if (/unit|all units/.test(t)) return ['All units', 'Building A', 'Building B', 'Townhomes'];
    return ['Option one', 'Option two', 'Option three'];
  }

  // --- modals ----------------------------------------------------------------
  function closeModal() { var m = document.querySelector('.modal-back'); if (m) m.remove(); }
  function openModal(o) {
    closeModal();
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<button class="modal-close" aria-label="Close">&times;</button>' +
      '<h3>' + o.title + '</h3>' +
      '<div class="modal-body">' + (o.bodyHTML || '') + '</div>' +
      (o.actionLabel ? '<div class="modal-actions"><button type="button" class="btn modal-do">' + o.actionLabel + '</button></div>' : '') +
      '</div>';
    document.body.appendChild(back);
    back.addEventListener('click', function (ev) {
      if (ev.target === back || ev.target.closest('.modal-close')) { closeModal(); return; }
      var doBtn = ev.target.closest('.modal-do');
      if (doBtn) { if (o.onAction) o.onAction(back); closeModal(); }
    });
    var first = back.querySelector('input,textarea');
    if (first) first.focus();
  }
  function openForm(title, fields, actionLabel, doneMsg) {
    var body = fields.map(function (f) {
      return '<div class="field" style="margin-bottom:12px"><span class="l">' + f[0] + '</span><input class="inp" placeholder="' + f[1] + '"></div>';
    }).join('');
    openModal({ title: title, bodyHTML: body, actionLabel: actionLabel, onAction: function () { toast(doneMsg); } });
  }
  function openPaste() {
    openModal({
      title: 'Paste your roster',
      bodyHTML: '<p style="color:var(--dim);font-size:13.5px;margin:0 0 10px">Copy rows from Excel or Google Sheets and paste below — we&rsquo;ll map the columns.</p>' +
        '<textarea class="inp" rows="6" placeholder="Jane Doe	4B	jane@email.com\nLuis Ortega	12	luis@email.com"></textarea>',
      actionLabel: 'Import roster', onAction: function () { toast('Roster imported ✓'); }
    });
  }
  function openUpload(title) {
    openModal({
      title: title || 'Upload',
      bodyHTML: '<div style="border:2px dashed var(--border-hover);border-radius:14px;padding:30px;text-align:center;background:var(--accent-soft)">' +
        '<div style="font-weight:700;margin-bottom:3px">Drop a file here</div>' +
        '<div style="font-size:12.5px;color:var(--dim)">PDF, CSV, or image &middot; or click to browse</div></div>',
      actionLabel: 'Upload', onAction: function () { toast('Uploaded ✓'); }
    });
  }
  function openDetail(el, label) {
    var ctx = rowContext(el);
    openModal({ title: ctx.title, bodyHTML: ctx.html, actionLabel: /resolve/i.test(label || '') ? 'Mark resolved' : 'Edit', onAction: function () { toast(/resolve/i.test(label || '') ? 'Resolved ✓' : 'Saved ✓'); } });
  }
  function openReply(el) {
    var ctx = rowContext(el);
    openModal({
      title: 'Reply',
      bodyHTML: '<p style="color:var(--dim);font-size:13.5px;margin:0 0 10px">Re: <strong>' + ctx.title + '</strong></p>' +
        '<textarea class="inp" rows="5" placeholder="Type your reply…"></textarea>',
      actionLabel: 'Send reply', onAction: function () { toast('Reply sent ✓'); }
    });
  }
  function rowContext(el) {
    var tr = el.closest('tr');
    if (tr) {
      var s = tr.querySelector('.strong');
      return { title: s ? s.textContent.trim() : (tr.children[0] ? tr.children[0].textContent.trim() : 'Details'), html: buildRowDetail(tr) };
    }
    var lr = el.closest('.lrow');
    if (lr) {
      var t = lr.querySelector('.ttl'), m = lr.querySelector('.meta');
      return {
        title: t ? t.textContent.trim() : 'Details',
        html: m ? '<p style="color:var(--dim);font-size:14px;margin:0">' + m.textContent.trim() + '</p>' : ''
      };
    }
    return { title: 'Details', html: '' };
  }
  function buildRowDetail(tr) {
    var table = tr.closest('table');
    var ths = table ? table.querySelectorAll('thead th') : [];
    var html = '<div style="display:flex;flex-direction:column;gap:9px">';
    Array.prototype.forEach.call(tr.children, function (td, i) {
      var label = ths[i] ? ths[i].textContent.trim() : '';
      var val = td.textContent.trim();
      if (!label || !val) return;
      html += '<div style="display:flex;justify-content:space-between;gap:18px;border-bottom:1px solid var(--border);padding-bottom:8px">' +
        '<span style="color:var(--dim);font-size:12.5px">' + label + '</span>' +
        '<span style="font-weight:600;font-size:13.5px;text-align:right">' + val + '</span></div>';
    });
    return html + '</div>';
  }

  // --- "View as" role switch -------------------------------------------------
  // Founders see the orange Platform tab; clients (community owners / board) do
  // not. Persisted across pages so navigation keeps the chosen role. If a client
  // lands on platform.html, show the same "Not authorized" gate the real app has.
  function getView() {
    try { return localStorage.getItem('mock_view') || 'founder'; } catch (e) { return 'founder'; }
  }
  function setView(v) {
    try { localStorage.setItem('mock_view', v); } catch (e) {}
    applyView(v);
  }
  // Per-role config. Operator roles all see the Platform tab; each gets a
  // different slice of the console (which tabs, whether revenue is visible,
  // where they land). Clients have no platform access at all.
  var ROLES = {
    founder:    { platform: true,  tabs: ['communities', 'subscriptions', 'activity', 'operators', 'support'], money: true,  def: 'communities',   badge: null, adminHide: [] },
    onboarding: { platform: true,  tabs: ['communities', 'activity', 'support'],                               money: false, def: 'communities',   badge: 'Onboarding access — communities &amp; support. No billing or team.',          adminHide: ['reports.html'] },
    support:    { platform: true,  tabs: ['support', 'activity'],                                              money: false, def: 'support',       badge: 'Support access — the support inbox. No financials.',                          adminHide: ['reports.html', 'community.html', 'roles.html'] },
    billing:    { platform: true,  tabs: ['communities', 'subscriptions', 'activity'],                         money: true,  def: 'subscriptions', badge: 'Billing access — financials only.',                                           adminHide: ['easy-track.html', 'easy-voice.html', 'easy-documents.html', 'easy-schedule.html', 'roles.html'] },
    client:     { platform: false, adminHide: [] }
  };

  function applyView(v) {
    var cfg = ROLES[v] || ROLES.founder;
    document.querySelectorAll('.viewas button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === v);
    });
    // Platform tab: every operator role sees it; clients never do.
    document.querySelectorAll('.nav a.plat').forEach(function (a) {
      a.style.display = cfg.platform ? '' : 'none';
    });
    // Admin tabs: gate by role. Overview is always visible; the rest hide per
    // the role's adminHide list (e.g. Billing only sees financial surfaces).
    var hide = cfg.adminHide || [];
    document.querySelectorAll('.nav a').forEach(function (a) {
      if (a.classList.contains('plat')) return;
      var href = a.getAttribute('href');
      if (href === 'index.html') { a.style.display = ''; return; }
      a.style.display = hide.indexOf(href) >= 0 ? 'none' : '';
    });

    var onPlatform = /platform\.html$/.test(location.pathname);
    var main = document.querySelector('main.page');
    var gate = document.getElementById('mock-gate');

    // Non-operator (client) on the Platform page → "Not authorized" gate
    if (onPlatform && !cfg.platform) {
      if (main) main.style.display = 'none';
      if (!gate) {
        gate = document.createElement('main');
        gate.id = 'mock-gate';
        gate.className = 'page';
        gate.innerHTML =
          '<div class="card" style="text-align:center;padding:48px 28px;max-width:540px;margin:48px auto">' +
          '<div style="font-size:40px">&#128274;</div>' +
          '<h1 style="margin:14px 0 8px">Not authorized</h1>' +
          '<p class="dek" style="margin:0 auto">The Platform Console is for Residente operators only. ' +
          'Your community admins and owners can&rsquo;t see this tab or open this page.</p>' +
          '<p style="margin-top:20px"><a class="btn" href="index.html">Back to your community</a></p>' +
          '</div>';
        document.body.insertBefore(gate, document.querySelector('script'));
      }
      gate.style.display = '';
      return;
    }
    if (main) main.style.display = '';
    if (gate) gate.style.display = 'none';

    // Money (revenue + resident balances) is visible to founders, billing
    // operators, and the community's own admins (client) — never to the
    // onboarding/support operator roles. Applies on EVERY page, not just here.
    setMoneyVisible(v === 'client' ? true : !!cfg.money);

    // Platform-console-only: scope which tabs show + the role badge.
    if (onPlatform) {
      document.querySelectorAll('.seg [data-tab]').forEach(function (b) {
        b.style.display = cfg.tabs.indexOf(b.getAttribute('data-tab')) >= 0 ? '' : 'none';
      });
      var active = document.querySelector('.seg [data-tab].on');
      if (!active || cfg.tabs.indexOf(active.getAttribute('data-tab')) < 0) {
        var def = document.querySelector('.seg [data-tab="' + cfg.def + '"]');
        if (def) def.click();
      }
      setBanner(cfg.badge);
    } else {
      setBanner(null);
    }
  }

  // Hide/show money — revenue (MRR/ARR/past-due) and resident balances.
  var MONEY_TILE = /mrr|past due|arr|run-rate|at risk|outstanding|collected|expenses|^net$|balance/;
  var MONEY_COL = /^(mrr|balance|amount|annual amount|outstanding)$/;
  function setMoneyVisible(show) {
    // explicitly tagged money elements (cards, rows, values)
    document.querySelectorAll('main.page .money').forEach(function (el) {
      el.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('main.page .stat').forEach(function (st) {
      var l = st.querySelector('.l');
      if (l && MONEY_TILE.test(l.textContent.trim().toLowerCase())) st.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('main.page table.tbl').forEach(function (tb) {
      tb.querySelectorAll('thead th').forEach(function (th, idx) {
        if (!MONEY_COL.test(th.textContent.trim().toLowerCase())) return;
        th.style.display = show ? '' : 'none';
        tb.querySelectorAll('tbody tr').forEach(function (tr) {
          if (tr.children[idx]) tr.children[idx].style.display = show ? '' : 'none';
        });
      });
    });
  }

  // Role badge under the title (text = role's scope; null removes it).
  function setBanner(text) {
    var note = document.getElementById('emp-note');
    if (text) {
      if (!note) {
        var dek = document.querySelector('main.page .dek');
        if (!dek) return;
        note = document.createElement('div');
        note.id = 'emp-note';
        note.style.cssText = 'display:inline-flex;align-items:center;gap:8px;background:var(--accent-soft);' +
          'color:var(--accent-deep);font-size:12.5px;font-weight:700;padding:7px 14px;border-radius:999px;margin:0 0 20px';
        dek.parentNode.insertBefore(note, dek.nextSibling);
      }
      note.innerHTML = '&#128100; ' + text;
    } else if (note) {
      note.remove();
    }
  }
  applyView(getView());
})();
