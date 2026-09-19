import os
import sys
import socket
import json
import time
import requests
from urllib.parse import urlparse
from flask import Flask, request, jsonify, Response, send_from_directory, stream_with_context
from flask_cors import CORS
import yt_dlp

# Base directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'frontend'))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')
CORS(app, resources={r"/*": {"origins": "*"}})

# In-memory cache for resolved stream URLs
# video_id -> {'url': str, 'title': str, 'thumbnail': str, 'duration': int, 'timestamp': float}
STREAM_CACHE = {}
CACHE_TTL = 3600  # 1 hour

def get_local_ip():
    """Find the local IP address for Wi-Fi network sharing."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

def format_duration(seconds):
    if not seconds:
        return "0:00"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"

def extract_video_audio(video_id):
    """Extract direct audio URL and metadata using yt-dlp."""
    now = time.time()
    if video_id in STREAM_CACHE:
        cached = STREAM_CACHE[video_id]
        if now - cached['timestamp'] < CACHE_TTL:
            return cached

    url = f"https://www.youtube.com/watch?v={video_id}"
    strategies = [
        ['android'],
        ['android', 'ios'],
        ['ios', 'android']
    ]

    last_err = None
    for clients in strategies:
        ydl_opts = {
            'format': 'bestaudio/best[ext=mp4]/18/best',
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'extractor_args': {
                'youtube': {
                    'player_client': clients
                }
            }
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                audio_url = info.get('url')
                if not audio_url and 'formats' in info:
                    for f in reversed(info['formats']):
                        if f.get('acodec') != 'none' and f.get('vcodec') == 'none':
                            audio_url = f.get('url')
                            break
                    if not audio_url:
                        for f in reversed(info['formats']):
                            if f.get('acodec') != 'none' and f.get('url'):
                                audio_url = f.get('url')
                                break
                    if not audio_url and len(info['formats']) > 0:
                        audio_url = info['formats'][-1].get('url')

                if audio_url:
                    data = {
                        'id': video_id,
                        'title': info.get('title', 'Unknown Title'),
                        'channel': info.get('uploader', info.get('channel', 'Unknown Artist')),
                        'thumbnail': info.get('thumbnail', f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"),
                        'duration': info.get('duration', 0),
                        'duration_str': format_duration(info.get('duration', 0)),
                        'audio_url': audio_url,
                        'timestamp': now
                    }
                    STREAM_CACHE[video_id] = data
                    return data
        except Exception as e:
            last_err = e
            continue

    if last_err:
        raise last_err
    raise Exception(f"Could not extract audio for video {video_id}")

@app.route('/api/search')
def search():
    query = request.args.get('q', '').strip()
    is_karaoke = request.args.get('karaoke', 'true').lower() == 'true'
    limit = int(request.args.get('limit', 15))

    if not query:
        return jsonify([])

    # If user provided a direct YouTube URL or video ID
    if 'youtube.com/watch' in query or 'youtu.be/' in query:
        if 'youtu.be/' in query:
            vid = query.split('youtu.be/')[1].split('?')[0].split('&')[0]
        else:
            from urllib.parse import parse_qs, urlparse
            parsed = urlparse(query)
            vid = parse_qs(parsed.query).get('v', [''])[0]
        if vid:
            try:
                info = extract_video_audio(vid)
                return jsonify([{
                    'id': info['id'],
                    'title': info['title'],
                    'channel': info['channel'],
                    'thumbnail': info['thumbnail'],
                    'duration': info['duration'],
                    'duration_str': info['duration_str']
                }])
            except Exception as e:
                return jsonify({'error': str(e)}), 400

    # Auto-add karaoke tag if requested and not present
    search_query = query
    if is_karaoke and not any(k in query.lower() for k in ['karaoke', 'instrumental', 'backing track', 'acapella']):
        search_query = f"{query} karaoke"

    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,
        'skip_download': True
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            results = ydl.extract_info(f"ytsearch{limit}:{search_query}", download=False)
            items = []
            if 'entries' in results:
                for entry in results['entries']:
                    if not entry or not entry.get('id'):
                        continue
                    vid = entry.get('id')
                    dur = entry.get('duration') or 0
                    items.append({
                        'id': vid,
                        'title': entry.get('title', 'Unknown Title'),
                        'channel': entry.get('uploader', entry.get('channel', '')),
                        'duration': dur,
                        'duration_str': format_duration(dur),
                        'thumbnail': entry.get('thumbnail') or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                    })
            return jsonify(items)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/info')
def video_info():
    video_id = request.args.get('id', '').strip()
    if not video_id:
        return jsonify({'error': 'Missing id parameter'}), 400
    try:
        data = extract_video_audio(video_id)
        # Return public metadata and stream proxy URL
        return jsonify({
            'id': data['id'],
            'title': data['title'],
            'channel': data['channel'],
            'thumbnail': data['thumbnail'],
            'duration': data['duration'],
            'duration_str': data['duration_str'],
            'stream_proxy': f"/api/audio-proxy?id={data['id']}"
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/audio-proxy')
def audio_proxy():
    """Stream audio chunks with range support and full CORS for Web Audio API."""
    video_id = request.args.get('id', '').strip()
    if not video_id:
        return Response('Missing video id', status=400)

    try:
        info = extract_video_audio(video_id)
        audio_url = info.get('audio_url')
        if not audio_url:
            return Response('Audio stream not available', status=404)

        # Forward range headers
        client_headers = {}
        if 'Range' in request.headers:
            client_headers['Range'] = request.headers['Range']
        
        client_headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

        upstream = requests.get(audio_url, headers=client_headers, stream=True, timeout=15)

        def generate():
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk

        response_headers = {
            'Content-Type': upstream.headers.get('Content-Type', 'audio/webm'),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
            'Cache-Control': 'public, max-age=3600'
        }

        if 'Content-Range' in upstream.headers:
            response_headers['Content-Range'] = upstream.headers['Content-Range']
        if 'Content-Length' in upstream.headers:
            response_headers['Content-Length'] = upstream.headers['Content-Length']

        return Response(
            stream_with_context(generate()),
            status=upstream.status_code,
            headers=response_headers
        )
    except Exception as e:
        return Response(f"Proxy error: {str(e)}", status=500)

@app.route('/api/network')
def network_info():
    ip = get_local_ip()
    port = request.environ.get('SERVER_PORT', 5000)
    return jsonify({
        'local_ip': ip,
        'port': port,
        'mobile_url': f"http://{ip}:{port}",
        'server_time': time.time()
    })

# Serve Frontend SPA
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(app.static_folder, path)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    local_ip = get_local_ip()
    print("=" * 60)
    print(" 🎤 KaraokeFlow Studio Server Running!")
    print(f" Local:   http://localhost:{port}")
    print(f" Mobile:  http://{local_ip}:{port}")
    print("=" * 60)
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
