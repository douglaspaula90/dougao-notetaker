import { useState, useEffect, useCallback } from "react";
import MeetingList from "./components/MeetingList";
import MeetingDetail from "./components/MeetingDetail";
import LoginScreen from "./components/LoginScreen";
import "./index.css";

const API = import.meta.env.VITE_API_URL || "/api";

function getAuthHeaders() {
  const key = localStorage.getItem("dougao_api_key");
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export default function App() {
  const [meetings, setMeetings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check if auth is needed on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/meetings/`, { headers: getAuthHeaders() });
        if (res.ok) {
          setAuthenticated(true);
        } else if (res.status === 401) {
          setAuthenticated(false);
        } else {
          setAuthenticated(true); // No auth configured
        }
      } catch {
        setAuthenticated(true); // Assume no auth if server unreachable
      } finally {
        setCheckingAuth(false);
      }
    })();
  }, []);

  const handleLogin = (key) => {
    setAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem("dougao_api_key");
    setAuthenticated(false);
  };

  const fetchMeetings = useCallback(async (query) => {
    try {
      const q = query !== undefined ? query : searchQuery;
      const url = q ? `${API}/meetings/?q=${encodeURIComponent(q)}` : `${API}/meetings/`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const data = await res.json();
      setMeetings(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    fetchMeetings();
    // Poll every 10s for processing updates
    const id = setInterval(fetchMeetings, 10000);
    return () => clearInterval(id);
  }, [fetchMeetings]);

  const handleSelect = async (meeting) => {
    if (meeting.status === "done") {
      const res = await fetch(`${API}/meetings/${meeting.id}`, { headers: getAuthHeaders() });
      const full = await res.json();
      setSelected(full);
    } else {
      setSelected(meeting);
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${API}/meetings/${id}`, { method: "DELETE", headers: getAuthHeaders() });
    setSelected(null);
    fetchMeetings();
  };

  if (checkingAuth) {
    return <div className="login-screen"><div className="processing-spinner" /></div>;
  }

  if (!authenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-mark">🎙️</div>
          <div style={{ flex: 1 }}>
            <h1>Dougao Notetaker</h1>
            <p>Meeting Intelligence</p>
          </div>
          {localStorage.getItem("dougao_api_key") && (
            <button className="btn-logout" onClick={handleLogout} title="Sair">⏻</button>
          )}
        </div>
        <div className="search-box">
          <input
            type="text"
            placeholder="Buscar reunioes..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              fetchMeetings(e.target.value);
            }}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => { setSearchQuery(""); fetchMeetings(""); }}>
              ✕
            </button>
          )}
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
  const [meetUrl, setMeetUrl] = useState("");
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  const handleSendBot = async () => {
    if (!meetUrl) return;
    setSending(true);
    setMessage("");
    try {
      const res = await fetch(`${API}/bot/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ meet_url: meetUrl, title: title || "Reuniao" }),
      });
      if (res.ok) {
        setMessage("Bot enviado! Aceite ele na reuniao.");
        setMeetUrl("");
        setTitle("");
      } else {
        const err = await res.json();
        setMessage(`Erro: ${err.error || err.detail || "Falha ao enviar bot"}`);
      }
    } catch {
      setMessage("Erro de conexao com o servidor.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="empty-state">
      <div className="empty-icon">🎙️</div>
      <h2>Enviar bot para uma reuniao</h2>
      <p>Cole o link do Google Meet e o bot entrara na reuniao para gravar.</p>
      <div className="bot-join-form">
        <input
          type="text"
          placeholder="https://meet.google.com/xxx-xxxx-xxx"
          value={meetUrl}
          onChange={(e) => setMeetUrl(e.target.value)}
        />
        <input
          type="text"
          placeholder="Nome da reuniao (opcional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button onClick={handleSendBot} disabled={sending || !meetUrl}>
          {sending ? "Enviando..." : "Enviar bot para a reuniao"}
        </button>
        {message && <div className="bot-join-message">{message}</div>}
      </div>
    </div>
  );
}
