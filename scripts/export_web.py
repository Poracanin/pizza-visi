#!/usr/bin/env python3
"""Read-only, resumable export of public Pizza Visi pages and referenced images.

Requires lxml and Pillow. Makes GET requests only. Never executes site scripts.
"""
import concurrent.futures as cf
import copy
import hashlib
import io
import json
import re
import time
import urllib.error
import urllib.parse as up
import urllib.request as ur
from datetime import datetime, timezone
from pathlib import Path
from lxml import etree, html
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'podklady-pizzavisi'
BASE = 'https://pizzavisi.cz/'
STAMP = datetime.now(timezone.utc).isoformat()
for folder in ['zdroje/html', 'zdroje/css', 'zdroje/sitemaps', 'fotky', 'grafika', 'dokumenty']:
    (ROOT / folder).mkdir(parents=True, exist_ok=True)
ERRORS = []
FETCH_LOG = []
ASSETS = {}
CSS = {}
SITEMAP_PAGES = {}


def write_json(name, obj):
    (ROOT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')


def norm(value):
    return re.sub(r'\s+', ' ', value or '').strip()


def txt(node):
    return norm(' '.join(node.itertext()))


def absolute(value, base=BASE):
    if not value or value.startswith(('data:', 'javascript:', '#', 'mailto:', 'tel:')):
        return None
    url = up.urljoin(base, value.strip())
    p = up.urlsplit(url)
    if p.scheme not in ('http', 'https'):
        return None
    return up.urlunsplit((p.scheme, p.netloc, p.path, p.query, ''))


def site_url(value, base=BASE):
    url = absolute(value, base)
    if not url:
        return None
    p = up.urlsplit(url)
    if p.hostname not in ('pizzavisi.cz', 'www.pizzavisi.cz') or p.query:
        return None
    if re.search(r'/(wp-admin|wp-json|wp-login|feed|comments|cart|checkout|my-account|kosik|pokladna)(/|\.)', p.path):
        return None
    if re.search(r'\.[a-zA-Z0-9]{2,5}$', p.path):
        return None
    return BASE.rstrip('/') + p.path.rstrip('/') + '/'


def filename(url, extension=None):
    p = up.urlsplit(url)
    name = up.unquote(p.path).strip('/').replace('/', '__') or 'index'
    name = re.sub(r'[^\w.\-]+', '-', name)[:160]
    if extension and not name.endswith(extension):
        name += extension
    if p.query:
        name = hashlib.sha256(url.encode()).hexdigest()[:10] + '-' + name
    return name


def fetch(url, path=None):
    if path and path.exists():
        return path.read_bytes(), url, 'cached'
    last = None
    for attempt in range(3):
        try:
            request = ur.Request(url, headers={'User-Agent': 'PizzaVisi-ContentArchive/1.0', 'Accept': '*/*'})
            with ur.urlopen(request, timeout=40) as response:
                data = response.read()
                final = response.url
                content_type = response.headers.get('Content-Type', '')
            if path:
                path.write_bytes(data)
            FETCH_LOG.append({'url': url, 'final_url': final, 'content_type': content_type, 'bytes': len(data), 'retrieved_at': datetime.now(timezone.utc).isoformat()})
            return data, final, content_type
        except Exception as exc:
            last = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code < 500:
                break
            time.sleep(attempt + 1)
    raise RuntimeError(str(last))


def add_asset(value, source, kind, alt=None):
    url = absolute(value, source)
    if not url:
        return
    if not re.search(r'\.(?:jpe?g|png|gif|webp|avif|svg|ico|pdf)$', up.urlsplit(url).path, re.I):
        return
    asset = ASSETS.setdefault(url, {'source_url': url, 'occurrences': []})
    occurrence = {'source_url': source, 'kind': kind}
    if alt is not None:
        occurrence['alt'] = alt
    if occurrence not in asset['occurrences']:
        asset['occurrences'].append(occurrence)


def collect_css(text, source):
    for match in re.finditer(r'url\(\s*[\"\']?([^\)\"\']+)', text):
        add_asset(match[1].strip(), source, 'css_image')


def load_sitemap(url):
    data, _, _ = fetch(url, ROOT / 'zdroje/sitemaps' / filename(url))
    tree = etree.fromstring(data)
    if etree.QName(tree).localname == 'sitemapindex':
        for loc in tree.xpath('//*[local-name()="sitemap"]/*[local-name()="loc"]/text()'):
            load_sitemap(loc)
    else:
        for node in tree.xpath('//*[local-name()="url"]'):
            loc = node.xpath('./*[local-name()="loc"]/text()')[0]
            SITEMAP_PAGES[loc] = {'sitemap_url': url, 'last_modified': next(iter(node.xpath('./*[local-name()="lastmod"]/text()')), None)}
            for image_url in node.xpath('./*[local-name()="image"]/*[local-name()="loc"]/text()'):
                add_asset(image_url, loc, 'sitemap_image')


def read_page(url):
    path = ROOT / 'zdroje/html' / filename(url, '.html')
    data, final, _ = fetch(url, path)
    return url, final, path, html.fromstring(data)


def text_lines(node):
    clean = copy.deepcopy(node)
    for element in clean.xpath('.//script|.//style|.//template'):
        element.drop_tree()
    # Preserve emoji as their visible alternative text.
    for element in clean.xpath('.//img[@alt]'):
        element.tail = ' ' + element.get('alt') + ' ' + (element.tail or '')
    return [norm(t) for t in clean.itertext() if norm(t)]


def parse_page(url, final, path, tree):
    for img in tree.xpath('//img|//source'):
        for key in ('src', 'data-src', 'data-lazy-src', 'data-original'):
            add_asset(img.get(key), url, 'image', img.get('alt'))
        for key in ('srcset', 'data-srcset', 'data-lazy-srcset'):
            for value in (img.get(key) or '').split(','):
                if value.strip():
                    add_asset(value.strip().split()[0], url, 'image_variant', img.get('alt'))
    for a in tree.xpath('//a[@href]'):
        add_asset(a.get('href'), url, 'linked_file', txt(a))
    for node in tree.xpath('//*[@style]'):
        collect_css(node.get('style'), url)
    for node in tree.xpath('//style'):
        collect_css(node.text or '', url)
    for node in tree.xpath('//link[@rel="stylesheet"]'):
        css_url = absolute(node.get('href'), url)
        if css_url and up.urlsplit(css_url).hostname == 'pizzavisi.cz':
            CSS.setdefault(css_url, []).append(url)
    for node in tree.xpath('//link[contains(@rel,"icon")]'):
        add_asset(node.get('href'), url, 'icon')
    for node in tree.xpath('//meta[@content]'):
        if node.get('property', '').endswith('image') or node.get('name', '').endswith('image'):
            add_asset(node.get('content'), url, 'social_image')
    # Elementor settings and JSON-LD may contain background and full-size images.
    decoded = html.tostring(tree, encoding='unicode').replace('\\/', '/')
    for value in re.findall(r'https?://[^\s<>"\'\\]+?\.(?:jpe?g|png|webp|gif|svg|avif)(?:\?[^\s<>"\'\\]*)?', decoded, re.I):
        add_asset(value, url, 'html_reference')
    schemas = []
    for node in tree.xpath('//script[@type="application/ld+json"]'):
        try:
            schemas.append(json.loads(node.text))
        except (ValueError, TypeError):
            pass
    links = []
    for node in tree.xpath('//a[@href]'):
        record = {'text': txt(node), 'href': up.urljoin(url, node.get('href'))}
        if record not in links:
            links.append(record)
    sections = []
    for node in tree.xpath('//*[@data-elementor-type="wp-page"]/* | //*[@data-elementor-type="wp-post"]/*'):
        lines = text_lines(node)
        if lines:
            sections.append({'id': node.get('id') or node.get('data-id'), 'headings': [{'level': int(h.tag[1]), 'text': txt(h)} for h in node.xpath('.//h1|.//h2|.//h3|.//h4')], 'text_lines': lines, 'text': '\n'.join(lines)})
    blocks = []
    for node in tree.xpath('//*[@data-widget_type]'):
        lines = text_lines(node)
        if lines:
            blocks.append({'id': node.get('data-id'), 'type': node.get('data-widget_type'), 'text': '\n'.join(lines), 'text_lines': lines})
    body = next(iter(tree.xpath('//body')), tree)
    lines = text_lines(body)
    return {'url': url, 'final_url': final, 'title': next(iter(tree.xpath('//title/text()')), ''), 'meta_description': next(iter(tree.xpath('//meta[@name="description"]/@content')), ''), 'language': tree.get('lang'), 'canonical_url': next(iter(tree.xpath('//link[@rel="canonical"]/@href')), None), 'source_html': str(path.relative_to(ROOT)), 'sitemap': SITEMAP_PAGES.get(url), 'headings': [{'level': int(h.tag[1]), 'text': txt(h)} for h in tree.xpath('//h1|//h2|//h3|//h4|//h5|//h6')], 'text_lines': lines, 'full_text': '\n'.join(lines), 'sections': sections, 'content_blocks': blocks, 'links': links, 'embeds': [{'src': n.get('src'), 'title': n.get('title')} for n in tree.xpath('//iframe')], 'forms': [{'action': n.get('action'), 'method': n.get('method'), 'fields': [{'tag': f.tag, 'name': f.get('name'), 'type': f.get('type'), 'placeholder': f.get('placeholder'), 'text': txt(f)} for f in n.xpath('.//input|.//textarea|.//select|.//button')]} for n in tree.xpath('//form')], 'structured_data': schemas}


def download_asset(record):
    url = record['source_url']
    name = Path(up.unquote(up.urlsplit(url).path)).name
    safe_name = re.sub(r'[^\w.\-]+', '-', name)
    is_graphic = bool(re.search(r'\.svg$|\.ico$|logo|transparent|icon|emoji|loading|loader|/themes/|/plugins/|/wp-includes/', url, re.I))
    folder = 'dokumenty' if name.lower().endswith('.pdf') else ('grafika' if is_graphic else 'fotky')
    path = ROOT / folder / (hashlib.sha256(url.encode()).hexdigest()[:10] + '-' + safe_name)
    try:
        data, final, ct = fetch(url, path)
        record.update({'status': 'downloaded', 'final_url': final, 'local_path': str(path.relative_to(ROOT)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'content_type': ct, 'category': folder})
        if folder != 'dokumenty' and not name.lower().endswith(('.svg', '.ico')):
            with Image.open(io.BytesIO(data)) as img:
                record.update({'width': img.width, 'height': img.height, 'format': img.format})
                img.verify()
        elif name.lower().endswith('.svg'):
            if etree.QName(etree.fromstring(data)).localname != 'svg':
                raise ValueError('Response is not an SVG image')
        return record
    except Exception as exc:
        record.update({'status': 'failed', 'error': str(exc)})
        if path.exists():
            path.unlink()
        return record


def main():
    fetch(BASE + 'robots.txt', ROOT / 'zdroje/robots.txt')
    load_sitemap(BASE + 'sitemap_index.xml')
    print(f'Sitemap: {len(SITEMAP_PAGES)} pages, {len(ASSETS)} image URLs', flush=True)
    pages = {}
    queue = set(SITEMAP_PAGES) | {BASE, BASE + 'menu/', BASE + 'rozvoz/'}
    attempted = set()
    while queue:
        batch = sorted(queue - attempted)
        if not batch:
            break
        queue = set()
        attempted.update(batch)
        with cf.ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(read_page, u): u for u in batch}
            for future in cf.as_completed(futures):
                url = futures[future]
                try:
                    result = future.result()
                    page = parse_page(*result)
                    pages[url] = page
                    for link in page['links']:
                        internal = site_url(link['href'], url)
                        if internal and internal not in attempted:
                            queue.add(internal)
                    print(f'Page {len(pages)}: {url}', flush=True)
                except Exception as exc:
                    ERRORS.append({'kind': 'page', 'url': url, 'error': str(exc)})
        if len(attempted) > 400:
            ERRORS.append({'kind': 'crawl_limit', 'remaining_urls': sorted(queue)})
            break
    print(f'CSS: {len(CSS)} stylesheets', flush=True)
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch, u, ROOT / 'zdroje/css' / filename(u, '.css')): u for u in CSS}
        for future in cf.as_completed(futures):
            url = futures[future]
            try:
                data, _, _ = future.result()
                collect_css(data.decode('utf-8', errors='replace'), url)
            except Exception as exc:
                ERRORS.append({'kind': 'stylesheet', 'url': url, 'error': str(exc)})
    for url, record in list(ASSETS.items()):
        if '/wp-content/uploads/' in url:
            original = re.sub(r'-\d+x\d+(?=\.[a-zA-Z]+(?:\?|$))', '', url)
            if original != url:
                add_asset(original, url, 'original_candidate')
                record['original_candidate_url'] = original
    print(f'Images/files: {len(ASSETS)} URLs', flush=True)
    assets = []
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for record in pool.map(download_asset, [ASSETS[u] for u in sorted(ASSETS)]):
            assets.append(record)
            print(f'Asset {len(assets)}/{len(ASSETS)}: {record["status"]} {record["source_url"]}', flush=True)
    # Deduplicate byte-identical files while preserving every source URL.
    by_hash = {}
    for record in assets:
        if record['status'] != 'downloaded':
            continue
        digest = record['sha256']
        if digest in by_hash:
            old = ROOT / record['local_path']
            record['local_path'] = by_hash[digest]
            if old != ROOT / record['local_path']:
                old.unlink(missing_ok=True)
        else:
            by_hash[digest] = record['local_path']
    primary = {BASE, BASE + 'menu/', BASE + 'rozvoz/'}
    for page in pages.values():
        page['role'] = 'primary' if page['url'] in primary else ('menu_detail' if '/menus/' in page['url'] else 'supporting_or_legacy')
        page['asset_urls'] = [a['source_url'] for a in assets if any(o['source_url'] == page['url'] for o in a['occurrences'])]
    write_json('stranky.json', sorted(pages.values(), key=lambda p: p['url']))
    write_json('media.json', assets)
    write_json('audit-stazeni.json', {'source_url': BASE, 'started_at': STAMP, 'finished_at': datetime.now(timezone.utc).isoformat(), 'sitemap_pages': SITEMAP_PAGES, 'stylesheet_sources': CSS, 'page_count': len(pages), 'asset_url_count': len(assets), 'unique_file_count': len(by_hash), 'errors': ERRORS, 'failed_assets': [a for a in assets if a['status'] != 'downloaded'], 'fetch_log': FETCH_LOG, 'scope': 'Public same-domain sitemap and recursively linked HTML pages, all referenced image variants, CSS backgrounds and verified original candidates. External destinations and interactive transactions are not crawled. Embedded maps are preserved by URL.'})
    print(json.dumps({'pages': len(pages), 'unique_files': len(by_hash), 'failed_assets': len([a for a in assets if a['status'] != 'downloaded']), 'errors': ERRORS}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
