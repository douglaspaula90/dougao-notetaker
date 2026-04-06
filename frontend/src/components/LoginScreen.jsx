import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "/api";

export default function LoginScreen({ onLogin }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key }),
      });

      if (res.ok) {
        localStorage.setItem("dougao_api_key", key);
        onLogin(key);
      } else {
        setError("Chave invalida. Tente novamente.");
      }
    } catch {
      setError("Erro de conexao com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-box" onSubmit={handleSubmit}>
        <div className="login-logo">🎙️</div>
        <h1>Dougao Notetaker</h1>
        <p>Insira sua chave de acesso para continuar</p>
        <input
          type="password"
          placeholder="API Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
        />
        {error && <div className="login-error">{error}</div>}
        <button type="submit" disabled={loading || !key}>
          {loading ? "Verificando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
