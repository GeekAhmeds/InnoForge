#!/usr/bin/env python3
"""Adds an Egyptian-Arabic voice-over to the recorded videos.

For every <id>.mp4 that has an <id>.captions.json next to it (written by record.cjs /
promo.cjs), each caption is spoken with Microsoft's Egyptian neural voice (edge-tts,
needs internet) and placed at the moment the caption appears. If a line runs into the
next one it waits for it; if the speech outlasts the video, the last frame is held.

    pip install edge-tts
    python3 tools/videos/voiceover.py <videosDir> [--voice ar-EG-SalmaNeural|ar-EG-ShakirNeural] [--out <dir>]

Writes <out>/<id>.mp4 (default <videosDir>/voiced/).
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile

import edge_tts


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out or 0)


async def speak(text, voice, rate, path):
    if voice == 'fake':  # offline test of the mixing: a tone as long as the speech would be
        secs = 0.7 + len(text) * 0.075
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'sine=frequency=440:duration={secs:.2f}', path], check=True)
        return
    for attempt in range(4):
        try:
            await edge_tts.Communicate(text, voice, rate=rate).save(path)
            if os.path.getsize(path) > 0:
                return
        except Exception as err:  # network hiccups: retry with a pause
            print(f'  retry {attempt + 1}: {err}', file=sys.stderr)
        await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(f'could not synthesize: {text[:40]}')


async def voice_one(video, captions, out, voice, rate):
    events = [e for e in json.load(open(captions, encoding='utf-8'))['events'] if e.get('say')]
    if not events:
        print(f'- {os.path.basename(video)}: no captions')
        return
    work = tempfile.mkdtemp(prefix='voice-')
    clips = []
    cursor = 0.0
    for i, e in enumerate(events):
        mp3 = os.path.join(work, f'{i:03d}.mp3')
        await speak(e['say'], voice, rate, mp3)
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
    ap.add_argument('dir')
    ap.add_argument('--voice', default='ar-EG-SalmaNeural')
    ap.add_argument('--rate', default='+0%')
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    out_dir = a.out or os.path.join(a.dir, 'voiced')
    os.makedirs(out_dir, exist_ok=True)
    done = 0
    for name in sorted(os.listdir(a.dir)):
        if not name.endswith('.mp4'):
            continue
        base = name[:-4]
        caps = os.path.join(a.dir, base + '.captions.json')
        if not os.path.exists(caps):
            continue
        await voice_one(os.path.join(a.dir, name), caps, os.path.join(out_dir, name), a.voice, a.rate)
        done += 1
    if not done:
        sys.exit('no <id>.mp4 + <id>.captions.json pairs found')


if __name__ == '__main__':
    asyncio.run(main())
