(function () {
  "use strict";

  const COLOR = {
    primary: "#0d6efd",
    danger: "#dc3545",
    success: "#198754",
    warning: "#ffc107",
    secondary: "#6c757d",
    grid: "#dee2e6",
  };
  const PALETTE = [COLOR.primary, COLOR.danger, COLOR.success, COLOR.warning, COLOR.secondary, "#6610f2"];

  let phaseChart, statusChart, timelineChart;
  let currentRecords = [];

  const el = (id) => document.getElementById(id);
  const getCheckedValues = (containerId) =>
    Array.from(document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`)).map((c) => c.value);

  const BADGE_CLASS = {
    RECRUITING: "text-bg-success",
    ENROLLING_BY_INVITATION: "text-bg-success",
    COMPLETED: "text-bg-primary",
    ACTIVE_NOT_RECRUITING: "text-bg-primary",
    TERMINATED: "text-bg-danger",
    WITHDRAWN: "text-bg-danger",
    SUSPENDED: "text-bg-danger",
    NO_LONGER_AVAILABLE: "text-bg-danger",
    NOT_YET_RECRUITING: "text-bg-warning",
    UNKNOWN: "text-bg-secondary",
  };

  function statusBadge(status) {
    const label = status.replaceAll("_", " ");
    const cls = BADGE_CLASS[status] || "text-bg-secondary";
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function renderStats(records) {
    el("stat-total").textContent = records.length;
    el("stat-recruiting").textContent = records.filter((r) => r.status === "RECRUITING").length;
    el("stat-countries").textContent = new Set(records.map((r) => r.country)).size;
  }

  function renderFetchedAt(iso) {
    if (!iso) return;
    const d = new Date(iso);
    el("fetched-at").textContent = `snapshot: ${d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
  }

  function renderTable(records) {
    const tbody = el("trials-tbody");
    tbody.innerHTML = "";
    el("table-empty").hidden = records.length > 0;
    for (const r of records) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="col-nct">${r.nct_id}</td>
        <td class="col-title">${r.title}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.phase}</td>
        <td>${r.study_type}</td>
        <td>${r.country}</td>
        <td>${r.start_year ?? "—"}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  function countBy(records, key) {
    const counts = {};
    for (const r of records) {
      const v = r[key] ?? "NA";
      counts[v] = (counts[v] || 0) + 1;
    }
    return counts;
  }

  function renderPhaseChart(records) {
    const counts = countBy(records, "phase");
    const labels = Object.keys(counts);
    const data = Object.values(counts);
    if (phaseChart) phaseChart.destroy();
    phaseChart = new Chart(el("chart-phase"), {
      type: "bar",
      data: {
        labels,
        datasets: [{ data, backgroundColor: PALETTE, maxBarThickness: 34 }],
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: COLOR.grid }, beginAtZero: true, ticks: { precision: 0 } },
          y: { grid: { display: false } },
        },
        maintainAspectRatio: false,
      },
    });
  }

  function renderStatusChart(records) {
    const counts = countBy(records, "status");
    const labels = Object.keys(counts);
    const data = Object.values(counts);
    if (statusChart) statusChart.destroy();
    statusChart = new Chart(el("chart-status"), {
      type: "bar",
      data: {
        labels: labels.map((l) => l.replaceAll("_", " ")),
        datasets: [{ data, backgroundColor: COLOR.primary, maxBarThickness: 34 }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: COLOR.grid }, beginAtZero: true, ticks: { precision: 0 } },
        },
        maintainAspectRatio: false,
      },
    });
  }

  function renderTimelineChart(records) {
    const counts = {};
    for (const r of records) {
      if (r.start_year) counts[r.start_year] = (counts[r.start_year] || 0) + 1;
    }
    const years = Object.keys(counts).map(Number).sort((a, b) => a - b);
    const data = years.map((y) => counts[y]);
    if (timelineChart) timelineChart.destroy();
    timelineChart = new Chart(el("chart-timeline"), {
      type: "line",
      data: {
        labels: years,
        datasets: [{
          data,
          borderColor: COLOR.danger,
          backgroundColor: "transparent",
          fill: false,
          tension: 0,
          pointRadius: 2,
          pointBackgroundColor: COLOR.danger,
          borderWidth: 1.5,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: COLOR.grid }, beginAtZero: true, ticks: { precision: 0 } },
        },
        maintainAspectRatio: false,
      },
    });
  }

  function toCsv(records) {
    const cols = ["nct_id", "title", "status", "phase", "study_type", "organization", "interventions", "country", "start_year"];
    const escape = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const header = cols.join(",");
    const rows = records.map((r) => cols.map((c) => escape(r[c])).join(","));
    return [header, ...rows].join("\r\n");
  }

  function downloadCsv() {
    if (!currentRecords.length) return;
    const csv = toCsv(currentRecords);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `neuroregen_trials_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function loadDashboard() {
    const btn = el("run-btn");
    btn.disabled = true;
    btn.querySelector("span").textContent = "Fetching…";

    const params = new URLSearchParams();
    params.set("condition", el("f-condition").value);
    params.set("keyword", el("f-keyword").value);
    getCheckedValues("f-status").forEach((s) => params.append("status", s));
    getCheckedValues("f-phase").forEach((p) => params.append("phase", p));

    try {
      const res = await fetch(`/api/trials?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Request failed");

      renderStats(payload.records);
      renderFetchedAt(payload.fetched_at);
      renderTable(payload.records);
      renderPhaseChart(payload.records);
      renderStatusChart(payload.records);
      renderTimelineChart(payload.records);
      currentRecords = payload.records;
    } catch (err) {
      el("fetched-at").textContent = `error: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.querySelector("span").textContent = "Update dashboard";
    }
  }

  el("run-btn").addEventListener("click", loadDashboard);
  el("csv-btn").addEventListener("click", downloadCsv);
  document.addEventListener("DOMContentLoaded", loadDashboard);
  loadDashboard();
})();
