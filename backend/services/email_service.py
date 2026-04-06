import os
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

logger = logging.getLogger(__name__)


def _get_smtp_config() -> dict:
    return {
        "host": os.environ.get("SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "user": os.environ.get("SMTP_USER", ""),
        "password": os.environ.get("SMTP_PASSWORD", ""),
        "from_name": os.environ.get("SMTP_FROM_NAME", "Dougao Notetaker"),
    }


def _format_duration(secs: int) -> str:
    if not secs:
        return "N/A"
    h = secs // 3600
    m = (secs % 3600) // 60
    return f"{h}h {m}min" if h > 0 else f"{m} min"


def _build_html(meeting: dict, summary_data: dict) -> str:
    title = meeting.get("title", "Reuniao")
    date = meeting.get("date", "")
    duration = _format_duration(meeting.get("duration_seconds", 0))
    participants = meeting.get("participants", [])
    if isinstance(participants, str):
        import json
        try:
            participants = json.loads(participants)
        except Exception:
            participants = []

    summary_text = summary_data.get("summary", "Sem resumo disponivel.")
    key_topics = summary_data.get("key_topics", [])
    decisions = summary_data.get("decisions", [])
    action_items = summary_data.get("action_items", [])
    sentiment = summary_data.get("sentiment", "neutro")

    sentiment_emoji = {"positivo": "😊", "negativo": "😟", "neutro": "😐"}.get(sentiment, "😐")

    topics_html = ""
    if key_topics:
        items = "".join(f'<li style="margin-bottom:4px;color:#374151;">{t}</li>' for t in key_topics)
        topics_html = f"""
        <div style="margin-bottom:20px;">
            <h3 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🏷 Topicos Principais</h3>
            <ul style="padding-left:20px;margin:0;">{items}</ul>
        </div>"""

    decisions_html = ""
    if decisions:
        items = "".join(f'<li style="margin-bottom:4px;color:#374151;">{d}</li>' for d in decisions)
        decisions_html = f"""
        <div style="margin-bottom:20px;">
            <h3 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">✅ Decisoes Tomadas</h3>
            <ul style="padding-left:20px;margin:0;">{items}</ul>
        </div>"""

    actions_html = ""
    if action_items:
        rows = ""
        for item in action_items:
            task = item.get("task", "")
            responsible = item.get("responsible", "A definir")
            deadline = item.get("deadline", "Nao definido")
            rows += f"""
            <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:500;">{task}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">{responsible}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">{deadline}</td>
            </tr>"""
        actions_html = f"""
        <div style="margin-bottom:20px;">
            <h3 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📋 Acionaveis</h3>
            <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
                <thead>
                    <tr style="background:#f9fafb;">
                        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Tarefa</th>
                        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Responsavel</th>
                        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Prazo</th>
                    </tr>
                </thead>
                <tbody>{rows}</tbody>
            </table>
        </div>"""

    participants_str = ", ".join(participants) if participants else "N/A"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#7c6fef,#a78bfa);border-radius:12px 12px 0 0;padding:28px 32px;color:#fff;">
            <div style="font-size:14px;opacity:0.85;margin-bottom:4px;">🎙️ Dougao Notetaker</div>
            <h1 style="margin:0;font-size:22px;font-weight:700;">{title}</h1>
        </div>

        <!-- Meta -->
        <div style="background:#fff;padding:16px 32px;border-bottom:1px solid #e5e7eb;display:flex;gap:24px;flex-wrap:wrap;">
            <div style="font-size:13px;color:#6b7280;">📅 <strong>{date[:10] if date else 'N/A'}</strong></div>
            <div style="font-size:13px;color:#6b7280;">⏱ <strong>{duration}</strong></div>
            <div style="font-size:13px;color:#6b7280;">👥 <strong>{participants_str}</strong></div>
            <div style="font-size:13px;color:#6b7280;">{sentiment_emoji} <strong>{sentiment}</strong></div>
        </div>

        <!-- Body -->
        <div style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px;">
            <!-- Summary -->
            <div style="margin-bottom:24px;">
                <h3 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📋 Resumo Executivo</h3>
                <p style="font-size:15px;line-height:1.7;color:#1f2937;margin:0;">{summary_text}</p>
            </div>

            {topics_html}
            {decisions_html}
            {actions_html}
        </div>

        <!-- Footer -->
        <div style="text-align:center;padding:20px;font-size:11px;color:#9ca3af;">
            Enviado automaticamente por Dougao Notetaker 🎙️
        </div>
    </div>
</body>
</html>"""


async def send_meeting_email(meeting: dict, summary_data: dict, recipients: list[str] | None = None):
    """Send meeting summary email after processing completes."""
    config = _get_smtp_config()

    if not config["user"] or not config["password"]:
        logger.warning("SMTP not configured — skipping email notification.")
        return

    if not recipients:
        default = os.environ.get("NOTIFICATION_EMAIL", "")
        if not default:
            logger.warning("No NOTIFICATION_EMAIL configured — skipping email.")
            return
        recipients = [r.strip() for r in default.split(",") if r.strip()]

    title = meeting.get("title", "Reuniao")
    html_body = _build_html(meeting, summary_data)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"🎙️ Resumo: {title}"
    msg["From"] = f"{config['from_name']} <{config['user']}>"
    msg["To"] = ", ".join(recipients)

    # Plain text fallback
    action_items = summary_data.get("action_items", [])
    plain = f"Resumo da reuniao: {title}\n\n"
    plain += summary_data.get("summary", "") + "\n\n"
    if action_items:
        plain += "ACIONAVEIS:\n"
        for item in action_items:
            plain += f"- {item.get('task', '')} ({item.get('responsible', 'A definir')})\n"

    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(config["host"], config["port"]) as server:
            server.starttls()
            server.login(config["user"], config["password"])
            server.sendmail(config["user"], recipients, msg.as_string())
        logger.info(f"Email sent to {recipients} for meeting '{title}'")
    except Exception as e:
        logger.error(f"Failed to send email: {e}", exc_info=True)
