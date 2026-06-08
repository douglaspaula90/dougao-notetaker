import { useState } from "react";

const SPEAKER_COLORS = [
  "#a593ff","#34d399","#60a5fa","#fbbf24","#f87171","#c084fc","#2dd4bf"
];

function speakerColor(name) {
  let hash = 0;
  for (let c of (name || "?")) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length];
}

function fmtTime(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(Math.floor(secs % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function fmtDuration(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
}

export default function MeetingDetail({ meeting, onDelete, onBack }) {
  const [tab, setTab] = useState("resumo");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const summary = meeting.summary_data || {};
  const transcript = meeting.transcript || [];
  const participants = meeting.participants || [];
  const actionItems = summary.action_items || meeting.action_items || [];

  if (meeting.status === "processing") {
    return (
      <div className="processing-state">
        <div className="processing-spinner" />
        <h3>Processando reunião...</h3>
        <p>Transcrevendo áudio, identificando speakers e gerando resumo. Isso pode levar alguns minutos.</p>
      </div>
    );
  }

  if (meeting.status === "error") {
    const stageLabel = {
      upload: "Recebimento do áudio",
      transcription: "Transcrição (Whisper)",
      no_content: "Áudio sem conteúdo (silêncio/vazio)",
      diarization: "Identificação de speakers (pyannote)",
      summary: "Resumo (GPT)",
      email: "Envio de e-mail",
    }[meeting.error_stage] || "Processamento";
    return (
      <div className="processing-state">
        <div style={{ fontSize: 48 }}>❌</div>
        <h3>Erro no processamento</h3>
        <p style={{ marginBottom: 8 }}><strong>Etapa que falhou:</strong> {stageLabel}</p>
        {meeting.error_message && (
          <pre style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a40",
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            color: "#fca5a5",
            textAlign: "left",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxWidth: 600,
            margin: "8px auto"
          }}>{meeting.error_message}</pre>
        )}
        <button className="btn danger" onClick={() => onDelete(meeting.id)}>Excluir</button>
      </div>
    );
  }

  const tabs = [
    { id: "resumo", label: "📋 Resumo" },
    { id: "acoes", label: `✅ Acionáveis (${actionItems.length})` },
    { id: "transcript", label: "📝 Transcrição" },
    { id: "participantes", label: `👥 Participantes (${participants.length})` },
  ];

  return (
    <div>
      {/* Header */}
      <div className="detail-header">
        <div className="detail-back" onClick={onBack}>← Voltar</div>
        <div className="detail-title">{meeting.title}</div>
        <div className="detail-meta">
          <span>📅 {fmtDate(meeting.date)}</span>
          <span>⏱ {fmtDuration(meeting.duration_seconds)}</span>
          {participants.length > 0 && <span>👥 {participants.join(", ")}</span>}
          {summary.sentiment && (
            <span className={`sentiment-badge sentiment-${summary.sentiment}`}>
              {summary.sentiment === "positivo" ? "😊" : summary.sentiment === "negativo" ? "😟" : "😐"}
              {" "}{summary.sentiment}
            </span>
          )}
        </div>
        <div className="detail-actions-bar">
          <button className="btn" onClick={() => copyTranscript(transcript)}>📋 Copiar transcrição</button>
          {confirmDelete ? (
            <>
              <button className="btn danger" onClick={() => onDelete(meeting.id)}>Confirmar exclusão</button>
              <button className="btn" onClick={() => setConfirmDelete(false)}>Cancelar</button>
            </>
          ) : (
            <button className="btn danger" onClick={() => setConfirmDelete(true)}>🗑 Excluir</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(t => (
          <div key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div className="tab-content">
        {tab === "resumo" && <SummaryTab summary={summary} />}
        {tab === "acoes" && <ActionItemsTab items={actionItems} />}
        {tab === "transcript" && <TranscriptTab segments={transcript} />}
        {tab === "participantes" && <ParticipantsTab participants={participants} summary={summary} />}
      </div>
    </div>
  );
}

// ── Summary Tab ──────────────────────────────────────────────────────────────
function SummaryTab({ summary }) {
  return (
    <div>
      <div className="cards-grid">
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-title">📋 Resumo Executivo</div>
          <div className="summary-text">{summary.summary || "Sem resumo disponível."}</div>
        </div>
      </div>
      <div className="cards-grid">
        {summary.key_topics?.length > 0 && (
          <div className="card">
            <div className="card-title">🏷 Tópicos Principais</div>
            <ul className="topic-list">
              {summary.key_topics.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>
        )}
        {summary.decisions?.length > 0 && (
          <div className="card">
            <div className="card-title">✅ Decisões Tomadas</div>
            <ul className="decision-list">
              {summary.decisions.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Action Items Tab ─────────────────────────────────────────────────────────
function ActionItemsTab({ items }) {
  if (!items.length) {
    return <div style={{ color: "var(--text3)", fontSize: 14 }}>Nenhum acionável identificado.</div>;
  }
  return (
    <div className="action-items">
      {items.map((item, i) => (
        <div className="action-item" key={i}>
          <div>
            <div className="action-task">{item.task}</div>
            <div className="action-meta">
              {item.responsible && <span>👤 {item.responsible}</span>}
              {item.deadline && item.deadline !== "Não definido" && (
                <span>📅 {item.deadline}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Transcript Tab ────────────────────────────────────────────────────────────
function TranscriptTab({ segments }) {
  if (!segments.length) {
    return <div style={{ color: "var(--text3)", fontSize: 14 }}>Transcrição não disponível.</div>;
  }
  return (
    <div className="transcript">
      {segments.map((seg, i) => (
        <div className="transcript-segment" key={i}>
          <div className="seg-meta">
            <div className="seg-speaker" style={{ color: speakerColor(seg.speaker) }}>
              {seg.speaker}
            </div>
            <div className="seg-time">{fmtTime(seg.start)}</div>
          </div>
          <div className="seg-text">{seg.text}</div>
        </div>
      ))}
    </div>
  );
}

// ── Participants Tab ──────────────────────────────────────────────────────────
function ParticipantsTab({ participants, summary }) {
  const participantsSummary = summary.participants_summary || {};

  if (!participants.length) {
    return <div style={{ color: "var(--text3)", fontSize: 14 }}>Nenhum participante identificado.</div>;
  }

  return (
    <div className="participants-grid">
      {participants.map((name, i) => (
        <div className="participant-card" key={i}>
          <div className="participant-avatar" style={{ background: speakerColor(name) }}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="participant-name">{name}</div>
          {participantsSummary[name] && (
            <div className="participant-summary">{participantsSummary[name]}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function copyTranscript(segments) {
  const text = segments.map(s => `[${fmtTime(s.start)}] ${s.speaker}: ${s.text}`).join("\n");
  navigator.clipboard.writeText(text).then(() => alert("Transcrição copiada!"));
}
