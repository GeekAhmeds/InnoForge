#!/usr/bin/env python3
"""Adds an Egyptian-Arabic voice-over to the recorded videos.

For every <id>.mp4 that has an <id>.captions.json next to it (written by record.cjs /
promo.cjs), each caption is spoken and placed at the moment the caption appears. If a
line runs into the next one it waits for it; if the speech outlasts the video, the last
frame is held.

Two engines:
  gemini  Google AI Studio (Gemini text-to-speech) told to speak in a Cairene accent —
          the most natural. Needs GEMINI_API_KEY (aistudio.google.com → Get API key).
          Voices: Kore, Puck, Charon, Zephyr, Aoede, Fenrir, Leda, Orus, Sulafat, Achird…
  edge    Microsoft Edge neural voices (ar-EG-SalmaNeural / ar-EG-ShakirNeural), free,
          no key, but closer to formal Arabic.

    python3 tools/videos/voiceover.py <videosDir> --engine gemini --voice Kore [--out <dir>]
    python3 tools/videos/voiceover.py --samples <dir> --engine gemini   # one sentence in many voices

Spoken lines are cached (--cache, default ~/.cache/innoforge-voice) so a re-run only pays
for lines that changed. Writes <out>/<id>.mp4 (default <videosDir>/voiced/).
"""
import argparse
import asyncio
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave

GEMINI_MODEL = 'gemini-2.5-flash-preview-tts'
GEMINI_BASE = os.environ.get('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com')
# How the model is asked to speak. The text itself is already written in Egyptian colloquial.
GEMINI_STYLE = ('Read the following Arabic text aloud in a natural Egyptian Arabic accent (Cairo, colloquial), '
                'warm, friendly and clear, like a modern Egyptian TV commercial voice-over. '
                'Pronounce it the way Egyptians speak, not Modern Standard Arabic. Read only the text:\n\n')
GEMINI_VOICES = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Sulafat', 'Puck', 'Charon', 'Orus', 'Fenrir', 'Achird']
SAMPLE_TEXT = 'أهلاً بيك في إنوفورج! بيع أسرع، وحسابات أدق، وكل ده من غير نت. جرّبه النهارده وانت هتشوف الفرق بنفسك.'


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out or 0)


_last_call = [0.0]


def gemini_tts(text, voice, model, style, min_interval):
    """One line through the Gemini API → 24 kHz 16-bit mono PCM bytes."""
    key = os.environ.get('GEMINI_API_KEY')
    if not key:
        sys.exit('GEMINI_API_KEY is not set (aistudio.google.com → Get API key)')
    body = json.dumps({
        'contents': [{'parts': [{'text': style + text}]}],
        'generationConfig': {
            'responseModalities': ['AUDIO'],
            'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}},
        },
    }).encode()
    url = f'{GEMINI_BASE}/v1beta/models/{model}:generateContent'
    for attempt in range(8):
        wait = _last_call[0] + min_interval - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                data = json.load(res)
            part = data['candidates'][0]['content']['parts'][0]['inlineData']
            return base64.b64decode(part['data'])
        except urllib.error.HTTPError as err:
            detail = err.read().decode('utf-8', 'replace')[:400]
            if err.code in (429, 500, 503) and attempt < 7:
                # Free-tier limits: wait as long as Google asks (or back off).
                m = re.search(r'"retryDelay":\s*"(\d+)', detail)
                delay = int(m.group(1)) + 1 if m else 10 * (attempt + 1)
                print(f'  {err.code}, waiting {delay}s…', file=sys.stderr)
                time.sleep(delay)
                continue
            sys.exit(f'Gemini TTS failed ({err.code}): {detail}')
        except (KeyError, IndexError) as err:
            if attempt < 3:
                time.sleep(5)
                continue
            sys.exit(f'Gemini TTS returned no audio: {err}')
        except urllib.error.URLError as err:
            if attempt < 5:
                time.sleep(5 * (attempt + 1))
                continue
            sys.exit(f'Gemini TTS unreachable: {err}')
    sys.exit('Gemini TTS: too many retries')


def write_wav(pcm, path, rate=24000):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


async def speak(text, voice, rate, path, opts):
    """Speaks one line into `path` (any audio file ffmpeg reads), through the cache."""
    engine = opts.engine
    if voice == 'fake' or engine == 'fake':  # offline test of the mixing: a tone as long as the speech would be
        secs = 0.7 + len(text) * 0.075
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'sine=frequency=440:duration={secs:.2f}', path], check=True)
        return
    key = hashlib.sha256(json.dumps([engine, voice, rate, opts.model, opts.style, text], ensure_ascii=False).encode()).hexdigest()[:32]
    cached = os.path.join(opts.cache, f'{key}{os.path.splitext(path)[1]}')
    if os.path.exists(cached) and os.path.getsize(cached) > 0:
        shutil.copyfile(cached, path)
        return
    if engine == 'gemini':
        write_wav(gemini_tts(text, voice, opts.model, opts.style, opts.min_interval), path)
    else:
        await edge_speak(text, voice, rate, path)
    os.makedirs(opts.cache, exist_ok=True)
    shutil.copyfile(path, cached)


async def edge_speak(text, voice, rate, path):
    import edge_tts
    for attempt in range(4):
        try:
            await edge_tts.Communicate(text, voice, rate=rate).save(path)
            if os.path.getsize(path) > 0:
                return
        except Exception as err:  # network hiccups: retry with a pause
            print(f'  retry {attempt + 1}: {err}', file=sys.stderr)
        await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(f'could not synthesize: {text[:40]}')


async def voice_one(video, captions, out, voice, rate, opts):
    events = [e for e in json.load(open(captions, encoding='utf-8'))['events'] if e.get('say')]
    if not events:
        print(f'- {os.path.basename(video)}: no captions')
        return
    work = tempfile.mkdtemp(prefix='voice-')
    clips = []
    cursor = 0.0
    for i, e in enumerate(events):
        mp3 = os.path.join(work, f'{i:03d}.{"wav" if opts.engine == "gemini" else "mp3"}')
        await speak(e['say'], voice, rate, mp3, opts)
        length = duration(mp3)
        start = max(float(e['start']) + 0.15, cursor)
        clips.append((mp3, start))
        cursor = start + length + 0.25
    video_len = duration(video)
    pad = max(0.0, cursor + 0.6 - video_len)

    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', video]
    for mp3, _ in clips:
        cmd += ['-i', mp3]
    parts = []
    for n, (_, start) in enumerate(clips, start=1):
        ms = int(start * 1000)
        parts.append(f'[{n}:a]adelay={ms}|{ms},aresample=44100[a{n}]')
    mix = ''.join(f'[a{n}]' for n in range(1, len(clips) + 1))
    parts.append(f'{mix}amix=inputs={len(clips)}:normalize=0:dropout_transition=0,volume=1.6[aout]')
    vf = f'tpad=stop_mode=clone:stop_duration={pad:.2f}' if pad > 0 else 'null'
    parts.append(f'[0:v]{vf}[vout]')
    cmd += ['-filter_complex', ';'.join(parts), '-map', '[vout]', '-map', '[aout]',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']
    subprocess.run(cmd + [out], check=True)
    print(f'✓ {out} ({len(clips)} lines, {duration(out):.1f}s)')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir', nargs='?')
    ap.add_argument('--engine', choices=['gemini', 'edge', 'fake'], default='gemini' if os.environ.get('GEMINI_API_KEY') else 'edge')
    ap.add_argument('--voice', default=None, help='Gemini: Kore, Puck, Charon… / edge: ar-EG-SalmaNeural…')
    ap.add_argument('--rate', default='+0%', help='edge only')
    ap.add_argument('--model', default=os.environ.get('GEMINI_TTS_MODEL') or GEMINI_MODEL)
    ap.add_argument('--style', default=GEMINI_STYLE, help='Gemini: how to speak (prefixed to every line)')
    ap.add_argument('--min-interval', type=float, default=float(os.environ.get('GEMINI_MIN_INTERVAL', '0')), help='seconds between Gemini calls')
    ap.add_argument('--cache', default=os.path.expanduser('~/.cache/innoforge-voice'))
    ap.add_argument('--only', default='', help='comma-separated video ids (e.g. 00-promo)')
    ap.add_argument('--samples', default=None, help='write the same sentence in several voices to this folder')
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    if not a.voice:
        a.voice = 'Kore' if a.engine == 'gemini' else 'ar-EG-SalmaNeural'
    if a.samples:
        os.makedirs(a.samples, exist_ok=True)
        voices = GEMINI_VOICES if a.engine == 'gemini' else ['ar-EG-SalmaNeural', 'ar-EG-ShakirNeural']
        for v in voices:
            raw = os.path.join(a.samples, f'{v}.{"wav" if a.engine == "gemini" else "mp3"}')
            await speak(SAMPLE_TEXT, v, a.rate, raw, a)
            mp3 = os.path.join(a.samples, f'sample-{v}.mp3')
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-b:a', '128k', mp3], check=True)
            os.remove(raw)
            print(f'✓ {mp3}')
        return
    if not a.dir:
        ap.error('the videos folder is required')
    only = {x.strip() for x in a.only.split(',') if x.strip()}
    out_dir = a.out or os.path.join(a.dir, 'voiced')
    os.makedirs(out_dir, exist_ok=True)
    done = 0
    for name in sorted(os.listdir(a.dir)):
        if not name.endswith('.mp4'):
            continue
        base = name[:-4]
        if only and base not in only:
            continue
        caps = os.path.join(a.dir, base + '.captions.json')
        if not os.path.exists(caps):
            continue
        await voice_one(os.path.join(a.dir, name), caps, os.path.join(out_dir, name), a.voice, a.rate, a)
        done += 1
    if not done:
        sys.exit('no <id>.mp4 + <id>.captions.json pairs found')


if __name__ == '__main__':
    asyncio.run(main())
