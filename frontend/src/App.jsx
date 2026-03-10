import { useState, useEffect, useCallback } from "react";
import MeetingList from "./components/MeetingList";
import MeetingDetail from "./components/MeetingDetail";
import "./index.css";

const API = import.meta.env.VITE_API_URL || "/api";

export default function App() {
  const [meetings, setMeetings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await fetch(`${API}/meetings/`);
      const data = await res.json();
      setMeetings(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMeetings();
    // Poll every 10s for processing updates
    const id = setInterval(fetchMeetings, 10000);
    return () => clearInterval(id);
  }, [fetchMeetings]);

  const handleSelect = async (meeting) => {
    if (meeting.status === "done") {
      const res = await fetch(`${API}/meetings/${meeting.id}`);
      const full = await res.json();
      setSelected(full);
    } else {
      setSelected(meeting);
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${API}/meetings/${id}`, { method: "DELETE" });
    setSelected(null);
    fetchMeetings();
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-mark">🎙️</div>
          <div>
            <h1>DougãoCast</h1>
            <p>Meeting Intelligence</p>
          </div>
        </div>
        <MeetingList
          meetings={meetings}
          loading={loading}
          selected={selected}
          onSelect={handleSelect}
        />
      </aside>
      <main className="main">
        {selected ? (
          <MeetingDetail
            meeting={selected}
            onDelete={handleDelete}
            onBack={() => setSelected(null)}
          />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-icon">🎙️</div>
      <h2>Selecione uma reunião</h2>
      <p>Escolha uma reunião na barra lateral para ver a transcrição, resumo e acionáveis.</p>
      <div className="empty-hint">
        <span>💡</span>
        <span>Use a extensão Chrome no Google Meet para gravar novas reuniões.</span>
      </div>
    </div>
  );
}
