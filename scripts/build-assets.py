#!/usr/bin/env python3
"""Builds the README artwork in docs/assets/ (hand-written SVG, no dependencies).

Run: python3 scripts/build-assets.py
SVGs animate with SMIL and CSS, which GitHub and npm render inside <img> tags.
Fonts are system stacks because an <img> SVG cannot load web fonts.
"""
import os
from html import escape

OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'assets')
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

# Agent colors: Claude warm orange, Codex green, Antigravity blue-violet.
CLAUDE, CODEX, GEMINI = '#E07A55', '#19C37D', '#7B8CFF'
HUB = '#F5C451'
BG0, BG1 = '#0B1020', '#161D38'
INK, MUTED = '#E8ECF8', '#9AA4C7'


def write(name, svg):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(svg.strip() + '\n')
    print('wrote', name)


def frame(w, h, body, defs='', radius=24):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{BG0}"/><stop offset="1" stop-color="{BG1}"/></linearGradient>
  <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#ffffff" opacity="0.06"/></pattern>
  {defs}
</defs>
<rect width="{w}" height="{h}" rx="{radius}" fill="url(#bg)"/>
<rect width="{w}" height="{h}" rx="{radius}" fill="url(#dots)"/>
{body}
</svg>'''


# ---- glyphs (generic shapes, not vendor logos) ----
def spark(cx, cy, r, color):
    """Eight-ray spark for Claude."""
    rays = ''.join(
        f'<line x1="{cx}" y1="{cy}" x2="{cx + r * c:.1f}" y2="{cy + r * s:.1f}" stroke="{color}" stroke-width="5" stroke-linecap="round"/>'
        for c, s in [(1, 0), (-1, 0), (0, 1), (0, -1), (.7, .7), (-.7, .7), (.7, -.7), (-.7, -.7)])
    return rays


def prompt_glyph(cx, cy, color):
    """Terminal prompt >_ for Codex."""
    return (f'<polyline points="{cx - 16},{cy - 12} {cx - 4},{cy} {cx - 16},{cy + 12}" fill="none" stroke="{color}" '
            f'stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<line x1="{cx + 2}" y1="{cy + 13}" x2="{cx + 18}" y2="{cy + 13}" stroke="{color}" stroke-width="5" stroke-linecap="round"/>')


def star4(cx, cy, r, color):
    """Four-point star for Antigravity/Gemini."""
    k = r * 0.22
    d = (f'M{cx},{cy - r} Q{cx + k},{cy - k} {cx + r},{cy} Q{cx + k},{cy + k} {cx},{cy + r} '
         f'Q{cx - k},{cy + k} {cx - r},{cy} Q{cx - k},{cy - k} {cx},{cy - r}Z')
    return f'<path d="{d}" fill="{color}"/>'


def node(cx, cy, color, glyph, label, sub, label_below=True):
    ly = cy + 74 if label_below else cy - 92
    return f'''
<g>
  <circle cx="{cx}" cy="{cy}" r="52" fill="{color}" opacity="0.12">
    <animate attributeName="r" values="46;58;46" dur="3.2s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.18;0.04;0.18" dur="3.2s" repeatCount="indefinite"/>
  </circle>
  <circle cx="{cx}" cy="{cy}" r="40" fill="#0E1430" stroke="{color}" stroke-width="3"/>
  {glyph}
  <text x="{cx}" y="{ly}" text-anchor="middle" font-family="{SANS}" font-size="17" font-weight="700" fill="{INK}">{label}</text>
  <text x="{cx}" y="{ly + 20}" text-anchor="middle" font-family="{MONO}" font-size="12.5" fill="{MUTED}">{sub}</text>
</g>'''


def packet(path_id, color, dur, begin, reverse=False):
    kp = '1;0' if reverse else '0;1'
    # Starts invisible: before `begin` a moving dot would otherwise sit at (0,0).
    return f'''<circle r="6" fill="{color}" opacity="0">
  <animateMotion dur="{dur}s" begin="{begin}s" repeatCount="indefinite" keyPoints="{kp}" keyTimes="0;1" calcMode="linear"><mpath href="#{path_id}"/></animateMotion>
  <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="{dur}s" begin="{begin}s" repeatCount="indefinite"/>
</circle>'''


# ---------------------------------------------------------------- hero
def hero():
    W, H = 1280, 440
    hx, hy = 960, 238
    nodes = {'claude': (770, 150, CLAUDE), 'codex': (1150, 150, CODEX), 'gemini': (960, 368, GEMINI)}
    paths = ''.join(f'<path id="p-{k}" d="M{hx},{hy} L{x},{y}" stroke="{c}" stroke-opacity="0.35" stroke-width="2.5" stroke-dasharray="6 8" fill="none">'
                    f'<animate attributeName="stroke-dashoffset" from="0" to="-28" dur="1.2s" repeatCount="indefinite"/></path>'
                    for k, (x, y, c) in nodes.items())
    packets = ''.join([
        packet('p-claude', CLAUDE, 2.4, 0, reverse=True), packet('p-codex', CODEX, 2.4, 1.2),
        packet('p-codex', CODEX, 2.4, 0.6, reverse=True), packet('p-gemini', GEMINI, 2.4, 1.8),
        packet('p-gemini', GEMINI, 2.4, 0.3, reverse=True), packet('p-claude', CLAUDE, 2.4, 1.5),
    ])
    title_defs = f'''<linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="{CLAUDE}"/><stop offset="0.5" stop-color="{HUB}"/><stop offset="1" stop-color="{GEMINI}"/></linearGradient>
  <radialGradient id="hubglow"><stop offset="0" stop-color="{HUB}" stop-opacity="0.55"/><stop offset="1" stop-color="{HUB}" stop-opacity="0"/></radialGradient>'''
    body = f'''
<text x="72" y="150" font-family="{SANS}" font-size="70" font-weight="800" fill="url(#title)" letter-spacing="-1.5">agent-intercom</text>
<text x="74" y="200" font-family="{SANS}" font-size="27" font-weight="600" fill="{INK}">Your coding agents, on one channel.</text>
<text x="74" y="240" font-family="{SANS}" font-size="18" fill="{MUTED}">Claude Code · Codex CLI · Antigravity — messages land</text>
<text x="74" y="266" font-family="{SANS}" font-size="18" fill="{MUTED}">straight in the open session. No polling.</text>
<g transform="translate(74,306)">
  <rect width="420" height="54" rx="12" fill="#0E1430" stroke="#2A3366"/>
  <text x="22" y="34" font-family="{MONO}" font-size="19" fill="{HUB}">$</text>
  <text x="44" y="34" font-family="{MONO}" font-size="19" fill="{INK}">npx agent-intercom install</text>
  <rect x="352" y="17" width="10" height="20" fill="{INK}"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect>
</g>
{paths}
{packets}
<circle cx="{hx}" cy="{hy}" r="80" fill="url(#hubglow)"><animate attributeName="r" values="64;92;64" dur="2.4s" repeatCount="indefinite"/></circle>
<circle cx="{hx}" cy="{hy}" r="34" fill="#1A1F3D" stroke="{HUB}" stroke-width="3"/>
<g fill="none" stroke="{HUB}" stroke-width="3" stroke-linecap="round">
  <path d="M{hx - 11},{hy - 9} q-7,9 0,18"/><path d="M{hx + 11},{hy - 9} q7,9 0,18"/>
  <path d="M{hx - 19},{hy - 15} q-12,15 0,30"/><path d="M{hx + 19},{hy - 15} q12,15 0,30"/>
</g>
<circle cx="{hx}" cy="{hy}" r="4.5" fill="{HUB}"/>
<text x="{hx + 48}" y="{hy + 6}" font-family="{MONO}" font-size="13" fill="{MUTED}">pushd</text>
{node(770, 150, CLAUDE, spark(770, 150, 20, CLAUDE), 'Claude Code', 'peer socket', label_below=False)}
{node(1150, 150, CODEX, prompt_glyph(1150, 150, CODEX), 'Codex CLI', 'app-server', label_below=False)}
{node(960, 368, GEMINI, star4(960, 368, 24, GEMINI), 'Antigravity', 'agentapi')}
'''
    # Gemini label sits to the side so it stays inside the frame.
    body = body.replace(f'<text x="960" y="442"', f'<text x="1092" y="364"').replace(f'<text x="960" y="462"', f'<text x="1092" y="384"')
    write('hero.svg', frame(W, H, body, title_defs, radius=28))


# ---------------------------------------------------------------- terminal demo
def demo():
    W, H, T = 1280, 600, 15.0  # T = loop length in seconds

    def term(x, title, color):
        return f'''
<g transform="translate({x},90)">
  <rect width="560" height="470" rx="14" fill="#0A0E1C" stroke="#262F57"/>
  <rect width="560" height="40" rx="14" fill="#141A33"/><rect y="26" width="560" height="14" fill="#141A33"/>
  <circle cx="22" cy="20" r="6" fill="#FF5F57"/><circle cx="42" cy="20" r="6" fill="#FEBC2E"/><circle cx="62" cy="20" r="6" fill="#28C840"/>
  <text x="280" y="25" text-anchor="middle" font-family="{MONO}" font-size="13" fill="{MUTED}">{title}</text>
  <circle cx="530" cy="20" r="5" fill="{color}"/>
</g>'''

    # (pane x, line index, show-at seconds, color, text)
    L, R = 60, 660
    C = '#C9D1F0'
    script = [
        (L, 0, 0.4, INK, '> ask codex to review src/parser.ts'),
        (L, 1, 1.4, CLAUDE, '● mail_send(to: "codex",'),
        (L, 2, 1.5, C, '    body: "Review src/parser.ts for edge cases")'),
        (L, 3, 2.1, MUTED, '  ⎿ sent 1792…a1b2 to codex'),
        (L, 4, 2.4, MUTED, '  waiting for the reply… (no polling)'),
        (R, 0, 3.4, HUB, '[agent-intercom] message a1b2 from claude:'),
        (R, 1, 3.5, C, 'Review src/parser.ts for edge cases'),
        (R, 3, 4.4, CODEX, '• Reading src/parser.ts (212 lines)'),
        (R, 4, 5.3, CODEX, '• Running the parser on odd inputs'),
        (R, 5, 6.3, C, '  2 issues: empty input throws,'),
        (R, 6, 6.4, C, '  CRLF line endings split tokens'),
        (R, 8, 7.3, CODEX, '● mail_send(to: "claude",'),
        (R, 9, 7.4, C, '    reply_to: "a1b2", body: "2 issues…")'),
        (L, 6, 8.6, HUB, '[agent-intercom] message c3d4 from codex'),
        (L, 7, 8.7, HUB, '(re a1b2):'),
        (L, 8, 8.8, C, '2 issues: empty input throws; CRLF'),
        (L, 9, 8.9, C, 'line endings split tokens.'),
        (L, 11, 9.9, CLAUDE, '● Fixing both and adding tests…'),
        (L, 12, 10.9, CODEX, '  ✓ 14 passed'),
    ]
    lines = []
    for x, row, t, color, text in script:
        a = t / T
        lines.append(f'<text x="{x + 22}" y="{168 + row * 30}" font-family="{MONO}" font-size="15.5" fill="{color}" opacity="0" xml:space="preserve">{escape(text)}'
                     f'<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;{a:.4f};{a + 0.012:.4f};0.95;1" dur="{T}s" repeatCount="indefinite"/></text>')

    def flight(t0, t1, left_to_right, color):
        a, b = t0 / T, t1 / T
        x0, x1 = (626, 654) if left_to_right else (654, 626)
        return f'''<g opacity="0">
  <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;{a:.3f};{a + .005:.3f};{b:.3f};{b + .005:.3f};1" dur="{T}s" repeatCount="indefinite"/>
  <circle cy="325" r="9" fill="{color}"><animate attributeName="cx" values="{x0};{x0};{x1};{x1}" keyTimes="0;{a:.3f};{b:.3f};1" dur="{T}s" repeatCount="indefinite"/></circle>
</g>'''

    body = f'''
<text x="640" y="54" text-anchor="middle" font-family="{SANS}" font-size="24" font-weight="700" fill="{INK}">Claude asks Codex for a review. The answer arrives as a new turn.</text>
{term(L, 'claude — my-api', CLAUDE)}
{term(R, 'codex — reviewer', CODEX)}
<line x1="626" y1="325" x2="654" y2="325" stroke="#2A3366" stroke-width="3" stroke-dasharray="4 5"/>
{flight(2.2, 3.3, True, CLAUDE)}
{flight(7.5, 8.5, False, CODEX)}
{''.join(lines)}
'''
    write('demo.svg', frame(W, H, body, radius=24))


# ---------------------------------------------------------------- how push works
def flow():
    W, H = 1280, 520

    def box(x, y, w, h, title, sub, color, mono_sub=True):
        return f'''<g transform="translate({x},{y})">
  <rect width="{w}" height="{h}" rx="14" fill="#10162E" stroke="{color}" stroke-width="2"/>
  <text x="{w / 2}" y="{h / 2 - 4}" text-anchor="middle" font-family="{SANS}" font-size="18" font-weight="700" fill="{INK}">{title}</text>
  <text x="{w / 2}" y="{h / 2 + 20}" text-anchor="middle" font-family="{MONO if mono_sub else SANS}" font-size="13" fill="{MUTED}">{sub}</text>
</g>'''

    def arrow(pid, d, color, dashed=False, dots=True, begin=0.0):
        dash = ' stroke-dasharray="7 7"' if dashed else ''
        dot = packet(pid, color, 2.2, begin) if dots else ''
        return (f'<path id="{pid}" d="{d}" fill="none" stroke="{color}" stroke-opacity="0.55" stroke-width="2.5"{dash} marker-end="url(#ah)"/>' + dot)

    defs = f'<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10z" fill="{MUTED}"/></marker>'
    body = f'''
<text x="640" y="56" text-anchor="middle" font-family="{SANS}" font-size="26" font-weight="800" fill="{INK}">How live push works</text>
<text x="640" y="86" text-anchor="middle" font-family="{SANS}" font-size="16" fill="{MUTED}">Event-driven: one file-system watcher, no polling, each message delivered exactly once</text>
{box(40, 200, 200, 100, 'mail_send', 'from any agent', HUB)}
{box(300, 200, 230, 100, 'inbox', '~/.agent-mail/&lt;name&gt;/', HUB)}
<g transform="translate(590,150)">
  <rect width="250" height="200" rx="16" fill="#151B3A" stroke="{HUB}" stroke-width="2.5"/>
  <text x="125" y="40" text-anchor="middle" font-family="{SANS}" font-size="20" font-weight="800" fill="{HUB}">pushd</text>
  <text x="125" y="78" text-anchor="middle" font-family="{SANS}" font-size="15" fill="{INK}">① claim  →  .pushing</text>
  <text x="125" y="108" text-anchor="middle" font-family="{SANS}" font-size="15" fill="{INK}">② inject into session</text>
  <text x="125" y="138" text-anchor="middle" font-family="{SANS}" font-size="15" fill="{INK}">③ move to read/</text>
  <text x="125" y="176" text-anchor="middle" font-family="{SANS}" font-size="13" fill="{MUTED}">failed? back to inbox, retry</text>
</g>
{box(960, 120, 280, 84, 'Claude Code', '/tmp/cc-socks/&lt;pid&gt;.sock', CLAUDE)}
{box(960, 214, 280, 84, 'Codex CLI', 'app-server · turn/start', CODEX)}
{box(960, 308, 280, 84, 'Antigravity (agy)', 'agentapi send-message', GEMINI)}
{arrow('f1', 'M240,250 L294,250', HUB, begin=0)}
{arrow('f2', 'M530,250 L584,250', HUB, begin=0.4)}
{arrow('f3', 'M840,220 C900,220 900,162 954,162', CLAUDE, begin=0.8)}
{arrow('f4', 'M840,250 L954,256', CODEX, begin=1.0)}
{arrow('f5', 'M840,280 C900,280 900,350 954,350', GEMINI, begin=1.2)}
<path d="M415,300 L415,440 L640,440" fill="none" stroke="{MUTED}" stroke-opacity="0.5" stroke-width="2" stroke-dasharray="6 7" marker-end="url(#ah)"/>
{box(650, 405, 330, 70, 'no open session?', 'stays in the inbox for mail_check', '#3A4475', mono_sub=False)}
'''
    write('how-push-works.svg', frame(W, H, body, defs, radius=24))


# ---------------------------------------------------------------- feature cards
ICONS = {
    'bolt': '<path d="M26 4 L10 30 H22 L18 52 L38 22 H26 Z" fill="none" stroke="{c}" stroke-width="4" stroke-linejoin="round"/>',
    'package': '<path d="M28 6 L50 17 V41 L28 52 L6 41 V17 Z M6 17 L28 28 L50 17 M28 28 V52" fill="none" stroke="{c}" stroke-width="4" stroke-linejoin="round"/>',
    'plug': '<path d="M20 6 V18 M36 6 V18 M12 18 H44 V28 C44 38 36 44 28 44 C20 44 12 38 12 28 Z M28 44 V54" fill="none" stroke="{c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    'network': '<circle cx="28" cy="10" r="6" fill="none" stroke="{c}" stroke-width="4"/><circle cx="10" cy="46" r="6" fill="none" stroke="{c}" stroke-width="4"/><circle cx="46" cy="46" r="6" fill="none" stroke="{c}" stroke-width="4"/><path d="M25 15 L13 40 M31 15 L43 40 M16 46 H40" stroke="{c}" stroke-width="4" stroke-linecap="round"/>',
    'check': '<circle cx="28" cy="28" r="22" fill="none" stroke="{c}" stroke-width="4"/><path d="M17 29 L25 37 L40 20" fill="none" stroke="{c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    'shield': '<path d="M28 4 L48 12 V28 C48 41 39 49 28 53 C17 49 8 41 8 28 V12 Z" fill="none" stroke="{c}" stroke-width="4" stroke-linejoin="round"/><path d="M19 28 L26 35 L38 22" fill="none" stroke="{c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    'terminal': '<rect x="4" y="8" width="48" height="40" rx="6" fill="none" stroke="{c}" stroke-width="4"/><path d="M14 22 L22 29 L14 36 M27 37 H40" fill="none" stroke="{c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    'book': '<path d="M6 10 C14 6 22 6 28 12 C34 6 42 6 50 10 V48 C42 44 34 44 28 50 C22 44 14 44 6 48 Z M28 12 V50" fill="none" stroke="{c}" stroke-width="4" stroke-linejoin="round"/>',
    'gear': '<circle cx="28" cy="28" r="8" fill="none" stroke="{c}" stroke-width="4"/><path d="M28 4 V12 M28 44 V52 M4 28 H12 M44 28 H52 M11 11 L17 17 M39 39 L45 45 M11 45 L17 39 M39 17 L45 11" stroke="{c}" stroke-width="4" stroke-linecap="round"/>',
}


def icon_svg(name, color, size=56):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 56 56">{ICONS[name].format(c=color)}</svg>'


def card(fname, icon, color, title, lines):
    W, H = 600, 210
    text = ''.join(f'<text x="128" y="{108 + i * 26}" font-family="{SANS}" font-size="17" fill="{MUTED}">{escape(t)}</text>' for i, t in enumerate(lines))
    body = f'''
<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="20" fill="none" stroke="{color}" stroke-opacity="0.45" stroke-width="2"/>
<rect x="32" y="40" width="72" height="72" rx="18" fill="{color}" opacity="0.14"/>
<g transform="translate(40,48)">{ICONS[icon].format(c=color)}</g>
<text x="128" y="72" font-family="{SANS}" font-size="25" font-weight="800" fill="{INK}">{escape(title)}</text>
{text}
'''
    write(fname, frame(W, H, body, radius=20))


def cards():
    card('card-push.svg', 'bolt', HUB, 'Live push, no polling', ['New mail becomes a new turn in the', 'open session, the way Claude Code\'s', 'own cross-session messages arrive.'])
    card('card-agents.svg', 'plug', GEMINI, 'Three CLIs, one inbox', ['Claude Code, Codex CLI and Antigravity', 'share one mailbox. Any other MCP', 'client can join with mail_check.'])
    card('card-once.svg', 'check', CODEX, 'Delivered exactly once', ['Messages are claimed before a push,', 'so a push and mail_check never both', 'deliver one. Failures go back to inbox.'])
    card('card-zero.svg', 'package', CLAUDE, 'Zero dependencies', ['Plain Node 20+ and a folder of JSON', 'files. No cloud, no account, no API', 'key. 13 files, about 19 kB.'])
    card('card-bridge.svg', 'network', '#5BC0EB', 'Across machines', ['bridge.sh moves mail over SSH, so', 'agents on a GPU box or HPC cluster', 'talk to the ones on your laptop.'])
    card('card-safe.svg', 'shield', '#E5848F', 'Local and labelled', ['Nothing leaves your machine. Pushed', 'text is tagged [agent-intercom] and', 'treated as a peer, not as you.'])


def heading_icons():
    for name, color in [('terminal', HUB), ('bolt', HUB), ('network', '#5BC0EB'), ('shield', '#E5848F'),
                        ('book', GEMINI), ('gear', MUTED), ('plug', GEMINI), ('check', CODEX)]:
        write(f'icon-{name}.svg', icon_svg(name, color))


# ---------------------------------------------------------------- social preview (1280x640, upload as PNG)
def social():
    W, H = 1280, 640
    title_defs = f'''<linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="{CLAUDE}"/><stop offset="0.5" stop-color="{HUB}"/><stop offset="1" stop-color="{GEMINI}"/></linearGradient>'''
    body = f'''
<text x="640" y="250" text-anchor="middle" font-family="{SANS}" font-size="104" font-weight="800" fill="url(#title)" letter-spacing="-2">agent-intercom</text>
<text x="640" y="330" text-anchor="middle" font-family="{SANS}" font-size="38" font-weight="600" fill="{INK}">Your coding agents, on one channel.</text>
<text x="640" y="390" text-anchor="middle" font-family="{SANS}" font-size="26" fill="{MUTED}">Claude Code · Codex CLI · Antigravity — live push into open sessions</text>
<g transform="translate(410,450)">
  <rect width="460" height="64" rx="14" fill="#0E1430" stroke="#2A3366"/>
  <text x="230" y="42" text-anchor="middle" font-family="{MONO}" font-size="24" fill="{INK}"><tspan fill="{HUB}">$ </tspan>npx agent-intercom install</text>
</g>
<circle cx="150" cy="120" r="34" fill="none" stroke="{CLAUDE}" stroke-width="4"/>{spark(150, 120, 16, CLAUDE)}
<circle cx="1130" cy="120" r="34" fill="none" stroke="{CODEX}" stroke-width="4"/>{prompt_glyph(1130, 120, CODEX)}
<circle cx="640" cy="90" r="34" fill="none" stroke="{GEMINI}" stroke-width="4"/>{star4(640, 90, 18, GEMINI)}
'''
    write('social-preview.svg', frame(W, H, body, title_defs, radius=0))


if __name__ == '__main__':
    hero(); demo(); flow(); cards(); heading_icons(); social()
