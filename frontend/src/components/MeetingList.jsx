export default function MeetingList({ meetings, loading, selected, onSelect }) {
  const fmt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

  const fmtDuration = (secs) => {
    if (!secs) return "";
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}min` : `${s}s`;
  };

  if (loading) {
    return (
      <div className="list-loading">
        {[1,2,3].map(i => <div key={i} className="skeleton" />)}
      </div>
    );
  }

  if (meetings.length === 0) {
    return (
      <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text3)", fontSize: "13px" }}>
        Nenhuma reunião ainda.<br />Use a extensão Chrome para gravar.
      </div>
    );
  }

  return (
    <div className="meeting-list">
      <div className="meeting-list-section-label">Reuniões</div>
      {meetings.map(m => (
        <div
          key={m.id}
          className={`meeting-card ${selected?.id === m.id ? "active" : ""}`}
          onClick={() => onSelect(m)}
        >
          <div className="meeting-card-title">{m.title}</div>
          <div className="meeting-card-meta">
            <StatusBadge status={m.status} />
            <span>{fmt(m.created_at)}</span>
            {m.duration_seconds > 0 && <span>⏱ {fmtDuration(m.duration_seconds)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    done:       { label: "Pronto", cls: "done" },
    processing: { label: "Processando", cls: "processing", dot: true },
    error:      { label: "Erro", cls: "error" },
  };
  const s = map[status] || map.processing;
  return (
    <span className={`status-badge ${s.cls}`}>
      {s.dot && <span className="pulse-dot" />}
      {s.label}
    </span>
  );
}
