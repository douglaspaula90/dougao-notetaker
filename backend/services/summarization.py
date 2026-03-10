import openai
import os
import json
import logging

logger = logging.getLogger(__name__)
client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

SYSTEM_PROMPT = """Você é um assistente especializado em análise de reuniões de negócios.
Analise a transcrição fornecida e responda APENAS com um JSON válido, sem texto adicional.
Todos os campos devem estar em português."""

USER_PROMPT_TEMPLATE = """Transcrição da reunião "{title}":

{transcript}

Retorne EXATAMENTE este JSON (sem markdown, sem texto extra):
{{
  "summary": "Resumo executivo da reunião em 3-5 frases",
  "key_topics": ["tópico 1", "tópico 2", "tópico 3"],
  "decisions": ["decisão tomada 1", "decisão tomada 2"],
  "action_items": [
    {{
      "task": "descrição clara da tarefa",
      "responsible": "nome do responsável ou 'A definir'",
      "deadline": "prazo mencionado ou 'Não definido'"
    }}
  ],
  "participants_summary": {{
    "NOME_DO_PARTICIPANTE": "resumo de 1 frase do que essa pessoa contribuiu"
  }},
  "sentiment": "positivo | neutro | negativo",
  "follow_up_suggested": true
}}"""

async def summarize_meeting(transcript_segments: list[dict], title: str = "Reunião") -> dict:
    """
    Generate meeting summary, action items and insights using GPT-4o mini.
    Very cheap: ~$0.01-0.03 per meeting.
    """
    # Format transcript for the prompt
    transcript_text = ""
    for seg in transcript_segments:
        minutes = int(seg["start"] // 60)
        seconds = int(seg["start"] % 60)
        timestamp = f"{minutes:02d}:{seconds:02d}"
        transcript_text += f"[{timestamp}] {seg['speaker']}: {seg['text']}\n"

    logger.info(f"Sending transcript to GPT-4o mini ({len(transcript_text)} chars)...")

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT_TEMPLATE.format(
                title=title,
                transcript=transcript_text
            )}
        ],
        temperature=0.3,
        response_format={"type": "json_object"}
    )

    result_text = response.choices[0].message.content
    logger.info(f"Summarization done. Tokens used: {response.usage.total_tokens}")

    try:
        return json.loads(result_text)
    except json.JSONDecodeError:
        logger.error(f"Failed to parse JSON: {result_text}")
        return {
            "summary": result_text,
            "action_items": [],
            "key_topics": [],
            "decisions": [],
            "sentiment": "neutro"
        }
