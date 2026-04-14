/* ==============================================
   THE ONE – personnel.js
   ============================================== */

'use strict';

/* ─────────────────────────────────────────────
   STORAGE HELPERS
───────────────────────────────────────────── */
const LS = {
  get(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
  },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },
};

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
let persons    = LS.get('theone_persons',    []);
let orgs       = LS.get('theone_orgs',       []);   // [{id, name, subs:[{id,name}]}]
let statuses   = LS.get('theone_statuses',   []);   // [{id, name, color}]
let statusCal  = LS.get('theone_status_cal', {});   // {[personId]: [{status,from,to}]}

let selectedPersonId = null;
let selectedStatus   = null;  // status object
let editingPersonId  = null;

// calendar
let calYear, calMonth; // 0-indexed month
(function initCalDate() {
  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();
})();

// drag
let dragActive  = false;
let dragPersonId = null;
let dragStart   = null;  // col index
let dragEnd     = null;  // col index
let dragDayList = [];    // sorted day numbers being painted

/* ─────────────────────────────────────────────
   SEED DATA (first run)
───────────────────────────────────────────── */
if (orgs.length === 0) {
  orgs = [
    { id: 'cat-0', name: '본부중대', subs: [
        { id: 'sub-0-0', name: '1소대' },
        { id: 'sub-0-1', name: '2소대' },
      ]
    },
    { id: 'cat-1', name: '1중대', subs: [
        { id: 'sub-1-0', name: '1소대' },
        { id: 'sub-1-1', name: '2소대' },
      ]
    },
  ];
  LS.set('theone_orgs', orgs);
}

if (statuses.length === 0) {
  statuses = [
    { id: 's-0', name: '출타', color: '#e67e22' },
    { id: 's-1', name: '열외', color: '#8e44ad' },
    { id: 's-2', name: '당직', color: '#c0392b' },
  ];
  LS.set('theone_statuses', statuses);
}

if (persons.length === 0) {
  persons = [
    { id: 'p-0', rank: '병장', name: '김민준', org: 'sub-0-0' },
    { id: 'p-1', rank: '상병', name: '이도윤', org: 'sub-0-1' },
    { id: 'p-2', rank: '일병', name: '박서준', org: 'sub-1-0' },
    { id: 'p-3', rank: '이병', name: '최지호', org: 'sub-1-1' },
  ];
  LS.set('theone_persons', persons);
}

/* ─────────────────────────────────────────────
   ORG HELPERS
───────────────────────────────────────────── */
function getOrgLabel(orgId) {
  for (const cat of orgs) {
    if (cat.id === orgId) return cat.name;
    for (const sub of cat.subs) {
      if (sub.id === orgId) return cat.name + ' ' + sub.name;
    }
  }
  return orgId;
}

/* ─────────────────────────────────────────────
   RENDER: PERSON TABLE
───────────────────────────────────────────── */
function getFilteredPersons() {
  const orgFilter    = document.getElementById('pnOrgTitle').textContent;
  const searchFilter = (document.getElementById('pnSearchInput').value || '').trim().toLowerCase();

  return persons.filter(p => {
    if (orgFilter !== '전체') {
      let match = false;
      for (const cat of orgs) {
        // Category name only: show all subs
        if (cat.name === orgFilter) {
          if (p.org === cat.id || cat.subs.some(s => s.id === p.org)) { match = true; break; }
        }
        // "상위조직명 하위조직명" format
        for (const sub of cat.subs) {
          const subLabel = cat.name + ' ' + sub.name;
          if (subLabel === orgFilter && sub.id === p.org) { match = true; break; }
        }
      }
      if (!match) return false;
    }
    if (searchFilter && !p.name.toLowerCase().includes(searchFilter)) return false;
    return true;
  });
}

function renderPersonTable() {
  const tbody = document.getElementById('pnTableBody');
  const all   = document.getElementById('pnCheckAll');
  const list  = getFilteredPersons();

  tbody.innerHTML = '';

  if (list.length === 0) {
    tbody.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa;font-size:12px;">인원이 없습니다.</div>';
    return;
  }

  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'pn-row' + (p.id === selectedPersonId ? ' selected' : '');
    row.dataset.id = p.id;
    row.innerHTML = `
      <div class="pn-td"><input type="checkbox" class="pn-row-check" data-id="${p.id}" /></div>
      <div class="pn-td">${esc(p.rank)}</div>
      <div class="pn-td">${esc(p.name)}</div>
      <div class="pn-td" style="font-size:11px;">${esc(getOrgLabel(p.org))}</div>
      <div class="pn-td">
        <span class="pn-status-badge">${esc(getCurrentStatus(p.id))}</span>
      </div>
    `;
    row.addEventListener('click', () => selectPerson(p.id));
    tbody.appendChild(row);
  });

  // sync check-all
  const checks = tbody.querySelectorAll('.pn-row-check');
  checks.forEach(c => {
    c.addEventListener('change', syncCheckAll);
    c.addEventListener('click', e => e.stopPropagation());
  });
  syncCheckAll();
}

function syncCheckAll() {
  const all    = document.getElementById('pnCheckAll');
  const checks = document.querySelectorAll('.pn-row-check');
  const total  = checks.length;
  const checked = Array.from(checks).filter(c => c.checked).length;
  all.indeterminate = checked > 0 && checked < total;
  all.checked = total > 0 && checked === total;
}

function getCurrentStatus(personId) {
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth() + 1, d = today.getDate();
  const cal = statusCal[personId] || [];
  for (const entry of cal) {
    if (entry.from <= `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` &&
        entry.to   >= `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`) {
      return entry.status;
    }
  }
  return '정상';
}

function selectPerson(id) {
  selectedPersonId = id;
  renderPersonTable();
  renderPersonDetail();
}

/* ─────────────────────────────────────────────
   RENDER: PERSON DETAIL
───────────────────────────────────────────── */
function renderPersonDetail() {
  const el = document.getElementById('pnPersonDetailContent');
  if (!selectedPersonId) {
    el.innerHTML = '<span class="pn-detail-empty">인원을 선택하세요</span>';
    el.classList.add('pn-detail-empty');
    return;
  }
  el.classList.remove('pn-detail-empty');
  const p = persons.find(x => x.id === selectedPersonId);
  if (!p) return;

  el.innerHTML = `
    <div class="pn-detail-info-row"><span class="pn-detail-info-label">계급</span><span>${esc(p.rank)}</span></div>
    <div class="pn-detail-info-row"><span class="pn-detail-info-label">이름</span><span>${esc(p.name)}</span></div>
    <div class="pn-detail-info-row"><span class="pn-detail-info-label">소속</span><span>${esc(getOrgLabel(p.org))}</span></div>
    <div class="pn-detail-info-row"><span class="pn-detail-info-label">현재 상태</span><span>${esc(getCurrentStatus(p.id))}</span></div>
  `;
}

/* ─────────────────────────────────────────────
   RENDER: STATUS GRID
───────────────────────────────────────────── */
function renderStatusGrid() {
  const grid = document.getElementById('pnStatusGrid');
  grid.innerHTML = '';

  statuses.forEach(s => {
    const item = document.createElement('div');
    item.className = 'pn-status-item' + (selectedStatus && selectedStatus.id === s.id ? ' selected' : '');
    item.dataset.id = s.id;
    item.innerHTML = `
      <div class="pn-status-color" style="background:${esc(s.color)};"></div>
      <div class="pn-status-name">${esc(s.name)}</div>
      <button class="pn-status-item-del" title="삭제" data-id="${esc(s.id)}">✕</button>
    `;

    // Click the item to select status
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('pn-status-item-del')) return;
      if (selectedStatus && selectedStatus.id === s.id) {
        selectedStatus = null;
        deactivateGuardOverlay();
      } else {
        selectedStatus = s;
        activateGuardOverlay();
      }
      renderStatusGrid();
      updateSelectedStatusLabel();
    });

    // Delete button
    item.querySelector('.pn-status-item-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteStatus(s.id, s.name);
    });

    grid.appendChild(item);
  });
}

function updateSelectedStatusLabel() {
  const label = document.getElementById('pnSelectedStatusLabel');
  if (selectedStatus) {
    label.textContent = `선택된 상태: ${selectedStatus.name}`;
  } else {
    label.textContent = '';
  }
}

/* ─────────────────────────────────────────────
   STATUS DELETE (cascade: remove from statusCal)
───────────────────────────────────────────── */
function deleteStatus(statusId, statusName) {
  if (!confirm(`"${statusName}" 상태를 삭제합니다. 월력표의 해당 상태 기록도 모두 삭제됩니다. 계속할까요?`)) return;

  // Remove from statuses list
  statuses = statuses.filter(s => s.id !== statusId);
  LS.set('theone_statuses', statuses);

  // Cascade: remove all statusCal entries with this status name
  let changed = false;
  Object.keys(statusCal).forEach(personId => {
    const before = statusCal[personId].length;
    statusCal[personId] = statusCal[personId].filter(entry => entry.status !== statusName);
    if (statusCal[personId].length !== before) changed = true;
  });
  if (changed) LS.set('theone_status_cal', statusCal);

  // If deleted status was selected, clear selection
  if (selectedStatus && selectedStatus.id === statusId) {
    selectedStatus = null;
    deactivateGuardOverlay();
    updateSelectedStatusLabel();
  }

  renderStatusGrid();
  renderCalendar();
  renderPersonTable();
}

/* ─────────────────────────────────────────────
   GUARD OVERLAY
───────────────────────────────────────────── */
function activateGuardOverlay() {
  const overlay = document.getElementById('pnGuardOverlay');
  overlay.classList.add('active');
}

function deactivateGuardOverlay() {
  const overlay = document.getElementById('pnGuardOverlay');
  overlay.classList.remove('active');
}

document.getElementById('pnGuardOverlay').addEventListener('click', () => {
  selectedStatus = null;
  deactivateGuardOverlay();
  renderStatusGrid();
  updateSelectedStatusLabel();
});

/* ─────────────────────────────────────────────
   ORG DROPDOWN
───────────────────────────────────────────── */
function renderOrgDropdown() {
  const dropdown = document.getElementById('pnOrgDropdown');
  dropdown.innerHTML = '';

  // "전체" option
  const allItem = document.createElement('div');
  allItem.className = 'pn-org-dropdown-item';
  allItem.textContent = '전체';
  allItem.addEventListener('click', () => {
    document.getElementById('pnOrgTitle').textContent = '전체';
    dropdown.style.display = 'none';
    renderPersonTable();
  });
  dropdown.appendChild(allItem);

  // Categories and subs
  orgs.forEach((cat, ci) => {
    // Category header
    const catItem = document.createElement('div');
    catItem.className = 'pn-org-dropdown-item category';
    catItem.textContent = cat.name;
    catItem.dataset.org = cat.id;
    catItem.addEventListener('click', () => {
      document.getElementById('pnOrgTitle').textContent = cat.name;
      dropdown.style.display = 'none';
      renderPersonTable();
    });
    dropdown.appendChild(catItem);

    // Sub items: display as "[상위조직명] [하위조직명]"
    cat.subs.forEach((sub, si) => {
      const subItem = document.createElement('div');
      subItem.className = 'pn-org-dropdown-item sub';
      subItem.textContent = cat.name + ' ' + sub.name;  // "본부중대 1소대"
      subItem.dataset.org = `sub-${ci}-${si}`;           // keep original data-org format
      subItem.addEventListener('click', () => {
        // orgTitle shows "상위조직명 하위조직명"
        document.getElementById('pnOrgTitle').textContent = cat.name + ' ' + sub.name;
        dropdown.style.display = 'none';
        renderPersonTable();
      });
      dropdown.appendChild(subItem);
    });
  });
}

document.getElementById('pnOrgBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('pnOrgDropdown');
  if (dropdown.style.display === 'none') {
    renderOrgDropdown();
    dropdown.style.display = 'block';
  } else {
    dropdown.style.display = 'none';
  }
});

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('pnOrgDropdown');
  if (!document.getElementById('pnOrgBtn').contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

/* ─────────────────────────────────────────────
   PERSON ADD / EDIT / DELETE
───────────────────────────────────────────── */
function populatePersonOrgSelect() {
  const sel = document.getElementById('pnInputOrg');
  sel.innerHTML = '';
  orgs.forEach((cat, ci) => {
    cat.subs.forEach((sub, si) => {
      const opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = cat.name + ' ' + sub.name;
      sel.appendChild(opt);
    });
  });
}

function openAddPersonModal() {
  editingPersonId = null;
  document.getElementById('pnPersonModalTitle').textContent = '인원 추가';
  document.getElementById('pnInputRank').value = '';
  document.getElementById('pnInputName').value = '';
  populatePersonOrgSelect();
  document.getElementById('pnPersonModal').classList.add('open');
}

function openEditPersonModal() {
  if (!selectedPersonId) { alert('수정할 인원을 선택하세요.'); return; }
  const p = persons.find(x => x.id === selectedPersonId);
  if (!p) return;
  editingPersonId = selectedPersonId;
  document.getElementById('pnPersonModalTitle').textContent = '인원 수정';
  document.getElementById('pnInputRank').value = p.rank;
  document.getElementById('pnInputName').value = p.name;
  populatePersonOrgSelect();
  document.getElementById('pnInputOrg').value = p.org;
  document.getElementById('pnPersonModal').classList.add('open');
}

function closePersonModal() {
  document.getElementById('pnPersonModal').classList.remove('open');
}

function savePersonModal() {
  const rank = document.getElementById('pnInputRank').value.trim();
  const name = document.getElementById('pnInputName').value.trim();
  const org  = document.getElementById('pnInputOrg').value;
  if (!rank || !name || !org) { alert('계급, 이름, 소속을 모두 입력하세요.'); return; }

  if (editingPersonId) {
    const p = persons.find(x => x.id === editingPersonId);
    if (p) { p.rank = rank; p.name = name; p.org = org; }
  } else {
    persons.push({ id: 'p-' + Date.now(), rank, name, org });
  }
  LS.set('theone_persons', persons);
  closePersonModal();
  renderPersonTable();
  renderCalendar();
}

function deleteSelectedPersons() {
  const checks = Array.from(document.querySelectorAll('.pn-row-check:checked')).map(c => c.dataset.id);
  if (checks.length === 0) { alert('삭제할 인원을 선택하세요.'); return; }
  if (!confirm(`${checks.length}명을 삭제합니다.`)) return;
  persons = persons.filter(p => !checks.includes(p.id));
  checks.forEach(id => { delete statusCal[id]; });
  LS.set('theone_persons', persons);
  LS.set('theone_status_cal', statusCal);
  if (checks.includes(selectedPersonId)) selectedPersonId = null;
  renderPersonTable();
  renderPersonDetail();
  renderCalendar();
}

document.getElementById('pnAddPersonBtn').addEventListener('click', openAddPersonModal);
document.getElementById('pnEditPersonBtn').addEventListener('click', openEditPersonModal);
document.getElementById('pnDelPersonBtn').addEventListener('click', deleteSelectedPersons);
document.getElementById('pnPersonModalClose').addEventListener('click', closePersonModal);
document.getElementById('pnPersonModalCancel').addEventListener('click', closePersonModal);
document.getElementById('pnPersonModalSave').addEventListener('click', savePersonModal);

document.getElementById('pnCheckAll').addEventListener('change', function() {
  document.querySelectorAll('.pn-row-check').forEach(c => { c.checked = this.checked; });
});

document.getElementById('pnSearchInput').addEventListener('input', renderPersonTable);

/* ─────────────────────────────────────────────
   STATUS ADD
───────────────────────────────────────────── */
document.getElementById('pnAddStatusBtn').addEventListener('click', () => {
  const name  = document.getElementById('pnStatusNameInput').value.trim();
  const color = document.getElementById('pnStatusColorPicker').value;
  if (!name) { alert('상태명을 입력하세요.'); return; }
  if (statuses.some(s => s.name === name)) { alert('동일한 상태명이 이미 존재합니다.'); return; }
  statuses.push({ id: 's-' + Date.now(), name, color });
  LS.set('theone_statuses', statuses);
  document.getElementById('pnStatusNameInput').value = '';
  renderStatusGrid();
});

/* ─────────────────────────────────────────────
   ORG MANAGEMENT MODAL
───────────────────────────────────────────── */
function openOrgModal() {
  renderOrgTree();
  populateSubParentSelect();
  document.getElementById('pnOrgModal').classList.add('open');
}

function closeOrgModal() {
  document.getElementById('pnOrgModal').classList.remove('open');
  renderOrgDropdown();
  renderPersonTable();
}

function renderOrgTree() {
  const container = document.getElementById('pnOrgTree');
  container.innerHTML = '';
  orgs.forEach((cat) => {
    const catDiv = document.createElement('div');
    catDiv.style.cssText = 'margin-bottom:8px;';

    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';

    const catName = document.createElement('strong');
    catName.style.cssText = 'font-size:12px;color:#1a3558;';
    catName.textContent = cat.name;

    const delCatBtn = document.createElement('button');
    delCatBtn.className = 'pn-btn pn-btn-danger';
    delCatBtn.style.cssText = 'padding:2px 8px;font-size:10px;';
    delCatBtn.textContent = '삭제';
    delCatBtn.addEventListener('click', () => deleteCat(cat.id));

    headerDiv.appendChild(catName);
    headerDiv.appendChild(delCatBtn);
    catDiv.appendChild(headerDiv);

    const subList = document.createElement('div');
    subList.style.cssText = 'padding-left:16px;display:flex;flex-wrap:wrap;gap:4px;';

    cat.subs.forEach((sub) => {
      const subEl = document.createElement('span');
      subEl.style.cssText = 'display:flex;align-items:center;gap:4px;background:#f0f2f5;border-radius:6px;padding:2px 8px;font-size:11px;';
      subEl.textContent = sub.name + ' ';

      const delSubBtn = document.createElement('button');
      delSubBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:#c0392b;font-size:12px;line-height:1;';
      delSubBtn.textContent = '✕';
      delSubBtn.addEventListener('click', () => deleteSub(cat.id, sub.id));

      subEl.appendChild(delSubBtn);
      subList.appendChild(subEl);
    });

    catDiv.appendChild(subList);
    container.appendChild(catDiv);
  });
}

function populateSubParentSelect() {
  const sel = document.getElementById('pnSubParentSelect');
  sel.innerHTML = '';
  orgs.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    sel.appendChild(opt);
  });
}

function deleteCat(catId) {
  if (!confirm('해당 상위 조직을 삭제합니다.')) return;
  orgs = orgs.filter(c => c.id !== catId);
  LS.set('theone_orgs', orgs);
  renderOrgTree();
  populateSubParentSelect();
}

function deleteSub(catId, subId) {
  const cat = orgs.find(c => c.id === catId);
  if (!cat) return;
  cat.subs = cat.subs.filter(s => s.id !== subId);
  LS.set('theone_orgs', orgs);
  renderOrgTree();
}

document.getElementById('pnAddCatBtn').addEventListener('click', () => {
  const name = document.getElementById('pnNewCatInput').value.trim();
  if (!name) { alert('조직명을 입력하세요.'); return; }
  orgs.push({ id: 'cat-' + Date.now(), name, subs: [] });
  LS.set('theone_orgs', orgs);
  document.getElementById('pnNewCatInput').value = '';
  renderOrgTree();
  populateSubParentSelect();
});

document.getElementById('pnAddSubBtn').addEventListener('click', () => {
  const catId = document.getElementById('pnSubParentSelect').value;
  const name  = document.getElementById('pnNewSubInput').value.trim();
  if (!catId || !name) { alert('상위 조직과 하위 조직명을 입력하세요.'); return; }
  const cat = orgs.find(c => c.id === catId);
  if (!cat) return;
  cat.subs.push({ id: 'sub-' + Date.now(), name });
  LS.set('theone_orgs', orgs);
  document.getElementById('pnNewSubInput').value = '';
  renderOrgTree();
});

document.getElementById('pnManageOrgBtn').addEventListener('click', openOrgModal);
document.getElementById('pnOrgModalClose').addEventListener('click', closeOrgModal);
document.getElementById('pnOrgModalClose2').addEventListener('click', closeOrgModal);

// Close modals on overlay click
document.querySelectorAll('.pn-modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

/* ─────────────────────────────────────────────
   CALENDAR RENDER
───────────────────────────────────────────── */
function renderCalendar() {
  const titleEl = document.getElementById('pnCalTitle');
  const bodyEl  = document.getElementById('pnCalBody');

  titleEl.textContent = `${calYear}년 ${calMonth + 1}월`;

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const table = document.createElement('table');
  table.className = 'pn-cal-table';

  // THEAD
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  const nameTh = document.createElement('th');
  nameTh.className = 'pn-name-col';
  nameTh.textContent = '이름';
  headRow.appendChild(nameTh);

  days.forEach(d => {
    const th = document.createElement('th');
    const weekDay = new Date(calYear, calMonth, d).getDay();
    if (weekDay === 0) th.classList.add('sun');
    if (weekDay === 6) th.classList.add('sat');
    th.innerHTML = `${d}<br><span style="font-weight:400;font-size:9px;">${['일','월','화','수','목','금','토'][weekDay]}</span>`;
    headRow.appendChild(th);
  });

  thead.appendChild(headRow);
  table.appendChild(thead);

  // TBODY
  const tbody = document.createElement('tbody');
  const filtered = getFilteredPersons();

  filtered.forEach(person => {
    const tr = document.createElement('tr');
    tr.dataset.personId = person.id;

    const nameTd = document.createElement('td');
    nameTd.className = 'pn-name-col';
    nameTd.textContent = `${person.rank} ${person.name}`;
    tr.appendChild(nameTd);

    days.forEach(d => {
      const td = document.createElement('td');
      td.dataset.day = d;
      td.dataset.personId = person.id;

      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cal = statusCal[person.id] || [];
      const entry = cal.find(e => e.from <= dateStr && e.to >= dateStr);

      const inner = document.createElement('span');
      inner.className = 'pn-cal-cell-inner' + (entry ? ' has-status' : '');
      if (entry) {
        const st = statuses.find(s => s.name === entry.status);
        inner.style.background = st ? st.color : '#999';
        inner.textContent = entry.status;
        inner.title = entry.status;
      }
      td.appendChild(inner);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  bodyEl.innerHTML = '';
  bodyEl.appendChild(table);

  setupCalDrag();
}

/* ─────────────────────────────────────────────
   CALENDAR DRAG
───────────────────────────────────────────── */
function setupCalDrag() {
  const calBody = document.getElementById('pnCalBody');
  // Remove previous listener to avoid duplicates after re-render
  calBody.removeEventListener('mousedown', onCalMouseDown);
  calBody.addEventListener('mousedown', onCalMouseDown);
}

function getCalCell(e) {
  return e.target.closest('td[data-day]');
}

function onCalMouseDown(e) {
  if (e.button !== 0) return;  // left click only

  const cell = getCalCell(e);
  if (!cell) return;

  const personId = cell.dataset.personId;
  const day = parseInt(cell.dataset.day);

  if (selectedStatus) {
    // Left drag: paint status
    dragActive   = true;
    dragPersonId = personId;
    dragStart    = day;
    dragEnd      = day;
    dragDayList  = [day];
    paintDragPreview();
    e.preventDefault();
  } else {
    // Left click without status: clear cell
    clearCalCell(personId, day);
    e.preventDefault();
  }
}

function onCalMouseMove(e) {
  if (!dragActive) return;
  const cell = getCalCell(e);
  if (!cell) return;
  if (cell.dataset.personId !== dragPersonId) return;

  const day = parseInt(cell.dataset.day);
  dragEnd = day;
  dragDayList = rangeDays(dragStart, dragEnd);
  paintDragPreview();
}

function onCalMouseUp(e) {
  if (!dragActive) return;
  dragActive = false;

  if (!selectedStatus || dragDayList.length === 0) { return; }

  // Save range
  const minDay = Math.min(...dragDayList);
  const maxDay = Math.max(...dragDayList);

  const fromStr = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(minDay).padStart(2,'0')}`;
  const toStr   = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(maxDay).padStart(2,'0')}`;

  if (!statusCal[dragPersonId]) statusCal[dragPersonId] = [];

  // Remove overlapping entries for the same person in this range
  statusCal[dragPersonId] = statusCal[dragPersonId].filter(entry => {
    return entry.to < fromStr || entry.from > toStr;
  });

  statusCal[dragPersonId].push({ status: selectedStatus.name, from: fromStr, to: toStr });
  statusCal[dragPersonId].sort((a, b) => a.from.localeCompare(b.from));

  LS.set('theone_status_cal', statusCal);
  dragDayList = [];
  renderCalendar();
  renderPersonTable();
}

function rangeDays(a, b) {
  const min = Math.min(a, b), max = Math.max(a, b);
  const out = [];
  for (let i = min; i <= max; i++) out.push(i);
  return out;
}

function paintDragPreview() {
  if (!dragPersonId) return;
  const calBody = document.getElementById('pnCalBody');
  const cells = calBody.querySelectorAll(`td[data-person-id="${dragPersonId}"][data-day]`);
  cells.forEach(td => {
    const day = parseInt(td.dataset.day);
    const inner = td.querySelector('.pn-cal-cell-inner');
    if (inner) {
      if (dragDayList.includes(day) && selectedStatus) {
        inner.style.background = selectedStatus.color;
        inner.style.opacity = '0.7';
        inner.textContent = selectedStatus.name;
        inner.classList.add('has-status');
      }
    }
  });
}

function clearCalCell(personId, day) {
  const dateStr = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  if (!statusCal[personId]) return;
  statusCal[personId] = statusCal[personId].filter(entry => !(entry.from <= dateStr && entry.to >= dateStr));
  LS.set('theone_status_cal', statusCal);
  renderCalendar();
  renderPersonTable();
}

/* ─────────────────────────────────────────────
   CALENDAR NAV
───────────────────────────────────────────── */
document.getElementById('pnCalPrev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});

document.getElementById('pnCalNext').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

// Global drag listeners (registered once)
document.addEventListener('mousemove', onCalMouseMove);
document.addEventListener('mouseup', onCalMouseUp);

/* ─────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────── */
function esc(str) {
  if (typeof str !== 'string') str = String(str || '');
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
renderPersonTable();
renderPersonDetail();
renderStatusGrid();
renderCalendar();
