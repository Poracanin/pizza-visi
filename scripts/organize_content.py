#!/usr/bin/env python3
"""Build redesign-ready JSON from the downloaded source archive, without network."""
import json
import re
import unicodedata
from pathlib import Path
from datetime import datetime, timezone
from lxml import html
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1] / 'podklady-pizzavisi'
BASE = 'https://pizzavisi.cz/'


def read(name):
    return json.loads((ROOT / name).read_text())


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def norm(value):
    return re.sub(r'\s+', ' ', value or '').strip()


def text(node):
    return norm(' '.join(node.itertext()))


def slug(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', value).strip('-')


def hasclass(cls):
    return f'contains(concat(" ",normalize-space(@class)," ")," {cls} ")'


def price(value):
    m = re.search(r'(\d+(?:[,.]\d+)?)\s*Kč', value)
    return float(m[1].replace(',', '.')) if m else None


def main():
    pages = read('stranky.json')
    media = read('media.json')
    audit = read('audit-stazeni.json')
    page_by_url = {p['url']: p for p in pages}
    media_by_url = {m['source_url']: m for m in media}
    primary_urls = [BASE, BASE + 'menu/', BASE + 'rozvoz/']
    for page in pages:
        path = page['url'].removeprefix(BASE)
        page['id'] = slug(path) or 'domu'

    def image_ref(url):
        if not url:
            return None
        record = media_by_url.get(url)
        original_url = re.sub(r'-\d+x\d+(?=\.[a-zA-Z]+$)', '', url)
        original = media_by_url.get(original_url)
        selected = original if original and original['status'] == 'downloaded' else record
        return {'source_url': url, 'original_url': original_url if original and original['status'] == 'downloaded' else None, 'local_path': selected.get('local_path') if selected else None, 'width': selected.get('width') if selected else None, 'height': selected.get('height') if selected else None}

    tree = html.parse(str(ROOT / page_by_url[BASE + 'menu/']['source_html']))
    categories = []
    by_category = {}
    current = None
    for node in tree.xpath('//*[@data-elementor-type="wp-page"]//*'):
        if node.tag == 'h2':
            current = text(node)
        is_grid = 'food-menu-grid-wrapper' in node.get('class', '').split()
        is_simple = node.tag == 'h5' and 'menu_post' in node.get('class', '').split() and 'size' not in node.get('class', '').split()
        if not (is_grid or is_simple):
            continue
        if is_grid:
            title_nodes = node.xpath('.//*[' + hasclass('food-menu-title') + ']')
            name = text(title_nodes[0])
            description_nodes = node.xpath('.//*[' + hasclass('food-menu-desc') + ']')
            description = text(description_nodes[0]) if description_nodes else ''
            image_urls = node.xpath('.//img/@src')
            variants = []
            titles = node.xpath('.//span[' + hasclass('menu_title') + ']')
            amounts = node.xpath('.//span[' + hasclass('menu_price') + ']')
            for size, amount in zip(titles, amounts):
                variants.append({'label': text(size), 'diameter_cm': int(re.search(r'\d+', text(size))[0]), 'price_czk': price(text(amount)), 'price_text': text(amount)})
            plain_prices = node.xpath('.//*[' + hasclass('food-menu-content-price-holder') + ']')
            if not variants and not plain_prices:
                plain_prices = node.xpath('.//*[' + hasclass('food-menu-price') + ']')
            plain_price = text(plain_prices[0]) if plain_prices else None
            wp_id = None
        else:
            name = text(node.xpath('.//span[' + hasclass('menu_title') + ']')[0])
            description = ''
            image_urls = []
            container = node.getparent()
            excerpt = container.xpath('./div[' + hasclass('menu_excerpt') + ']')
            amounts = node.xpath('.//span[' + hasclass('menu_price') + ']')
            plain_price = text(amounts[0]) if amounts else (text(excerpt[0]) if excerpt else '')
            values = re.findall(r'(\d+)\s*Kč', plain_price)
            variants = [{'label': f'{diameter} cm', 'diameter_cm': diameter, 'price_czk': int(amount), 'price_text': f'{amount} Kč'} for diameter, amount in zip([30, 40], values)] if len(values) == 2 else []
            wp_id = container.get('id')
        category_name = 'Balení' if name == 'Pizza krabice' else current
        if category_name not in by_category:
            category = {'id': slug(category_name), 'name': category_name, 'items': []}
            categories.append(category)
            by_category[category_name] = category
        item = {'id': slug(name), 'name': name, 'description': description, 'ingredients': [i.strip() for i in description.split(',')] if description else [], 'prices': variants, 'price_czk': price(plain_price) if plain_price and not variants else None, 'price_text': plain_price, 'image': image_ref(image_urls[0]) if image_urls else None, 'source_url': BASE + 'menu/', 'source_element_id': wp_id, 'allergens': None}
        if re.match(r'^\d+\.', name):
            item['number'] = int(re.match(r'^\d+', name)[0])
        by_category[category_name]['items'].append(item)

    menu_items = [i for c in categories for i in c['items']]
    # Link currently displayed menu records to independently archived detail pages.
    for item in menu_items:
        matching = []
        for page in pages:
            if page['role'] == 'menu_detail' and any(slug(h['text']) == item['id'] for h in page['headings'] if h['level'] == 1):
                matching.append(page['url'])
        item['detail_urls'] = matching

    home = page_by_url[BASE]
    delivery_page = page_by_url[BASE + 'rozvoz/']
    org_schema = next(n for data in home['structured_data'] for n in data.get('@graph', []) if n.get('@type') == 'Organization')
    branches = [
        {'id': 'rudna', 'name': 'Rudná (u Prahy)', 'address': 'Riegerova 527/50, Rudná (u Prahy)', 'phone': '+420 606 918 942', 'phone_uri': 'tel:+420606918942', 'delivery_areas': ['Rudná (u Prahy)', 'Nučice', 'Chrášťany', 'Drahelčice', 'Úhonice', 'Tachlovice', 'Jinočany', 'Zbuzany', 'Vysoký Újezd', 'Praha-Zličín', 'Praha-Třebonice']},
        {'id': 'hostivice', 'name': 'Hostivice', 'address': 'Husovo náměstí 60, Hostivice', 'phone': '+420 606 518 565', 'phone_uri': 'tel:+420606518565', 'delivery_areas': ['Hostivice', 'Praha – Zličín', 'Praha – Řepy', 'Praha – Ruzyně', 'Jeneč', 'Hostouň', 'Dobrovíz', 'Kněževes', 'Středokluky', 'Svárov', 'Chýně', 'Červený Újezd', 'Praha – Sobín']},
        {'id': 'beroun', 'name': 'Beroun', 'address': 'Pivovarská 105/11, Beroun', 'phone': '+420 737 857 493', 'phone_uri': 'tel:+420737857493', 'delivery_areas': ['Beroun', 'Králův dvůr', 'Vraž', 'Hýskov', 'Tetín', 'Popovice', 'Trubín']},
    ]
    for branch, embed in zip(branches, delivery_page['embeds']):
        assert branch['phone_uri'] in [link['href'] for link in home['links']]
        for area in branch['delivery_areas']:
            assert area in delivery_page['full_text'], area
        branch.update({'opening_hours_text': 'Pondělí-Sobota: 11-21', 'opening_hours': {'days': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], 'opens': '11:00', 'closes': '21:00', 'sunday': None}, 'map_embed_url': embed['src'], 'source_urls': [BASE, BASE + 'rozvoz/']})
    legal_address = 'Riegrova 527/50, 252 19, Rudná'
    assert legal_address in home['full_text']
    organization = {'name': org_schema['name'], 'website': BASE, 'operator': 'Antonín Visinger', 'ico': '05804981', 'dic': 'CZ9610050032', 'registered_address_verbatim': legal_address, 'registration_text': next(line for line in home['text_lines'] if line.startswith('Fyzická osoba zapsaná')), 'copyright_text': next(line for line in home['text_lines'] if line.startswith('Copyright')), 'logo': image_ref(org_schema['logo']['url']), 'social_links': [link for link in home['links'] if any(host in link['href'] for host in ['instagram.com', 'facebook.com'])], 'email': None, 'source_url': BASE}

    documents = []
    for asset in media:
        if asset.get('category') == 'dokumenty' and asset['status'] == 'downloaded':
            reader = PdfReader(ROOT / asset['local_path'])
            extracted = [{'page': n + 1, 'text': page.extract_text() or ''} for n, page in enumerate(reader.pages)]
            full_text = '\n\n'.join(p['text'] for p in extracted)
            entries = []
            for line in full_text.splitlines():
                match = re.match(r'\s*(\d+)\.\s*(.*?)\s*-\s*([\d,\s]+)$', line)
                if match:
                    entries.append({'number': int(match[1]), 'name_verbatim': match[2].strip(), 'allergen_numbers_verbatim': [int(n) for n in re.findall(r'\d+', match[3])]})
            documents.append({'source_url': asset['source_url'], 'local_path': asset['local_path'], 'pages': extracted, 'full_text': full_text, 'allergen_entries': entries, 'status': 'historical_names_require_client_review', 'review_note': 'PDF obsahuje jen 21 pizz; používá názvy Hawai, Fantazie a Krkovička, zatímco aktuální menu má Ananasová, Symfonie a Z komína. Položky 22–24 v PDF chybí.'})
    write('dokumenty.json', documents)

    primary_page_styles = {url for url, refs in audit['stylesheet_sources'].items() if any(ref in primary_urls for ref in refs)}
    for asset in media:
        direct = any(o['source_url'] in primary_urls or o['source_url'] in primary_page_styles for o in asset['occurrences'])
        asset['used_on_primary_pages_or_styles'] = direct
    for asset in media:
        if any(o['kind'] == 'original_candidate' and media_by_url.get(o['source_url'], {}).get('used_on_primary_pages_or_styles') for o in asset['occurrences']):
            asset['used_on_primary_pages_or_styles'] = True
    write('media.json', media)
    primary_images = [a for a in media if a.get('used_on_primary_pages_or_styles') and a['status'] == 'downloaded']
    photo_groups = {}
    for asset in media:
        if asset['status'] != 'downloaded' or asset['category'] != 'fotky':
            continue
        family = re.sub(r'-(?:\d+x\d+|scaled)(?=\.[a-zA-Z]+$)', '', asset['source_url'])
        group = photo_groups.setdefault(family, {'family_url': family, 'used_on_primary_pages': False, 'variants': []})
        group['used_on_primary_pages'] |= bool(asset.get('used_on_primary_pages_or_styles'))
        group['variants'].append({key: asset[key] for key in ['source_url', 'local_path', 'width', 'height', 'bytes', 'sha256'] if key in asset})
    for group in photo_groups.values():
        group['recommended'] = max(group['variants'], key=lambda a: a.get('width', 0) * a.get('height', 0))
    write('fotky.json', list(photo_groups.values()))
    findings = [
        {'type': 'source_spelling_difference', 'text': 'Kontakty používají Riegerova 527/50, právní patička Riegrova 527/50. Obě podoby jsou zachovány; před redesignem ověřit s klientem.', 'source_urls': [BASE, BASE + 'rozvoz/']},
        {'type': 'opening_hours_unspecified', 'text': 'Web uvádí otevírací dobu Po–So 11–21. Neděle není uvedena, proto má v JSON hodnotu null.', 'source_url': BASE},
        {'type': 'archival_content', 'text': 'Vedle 3 hlavních stránek jsou archivovány položky menu, kategorie, šablony hlavičky/patičky a staré veřejné WooCommerce stránky. Hlavní menu.json vychází pouze z aktuálně zobrazené stránky /menu/.', 'source_url': BASE + 'sitemap_index.xml'},
        {'type': 'embedded_maps', 'text': 'Mapy Google jsou uloženy jako původní URL vložení; mapové dlaždice a obsah externích destinací se nestahují.'},
        {'type': 'allergen_mapping', 'text': 'PDF s alergeny je archivováno včetně textu a 21 strukturovaných řádků. Oproti aktuálním 24 pizzám chybějí položky 22–24 a názvy 5 (Hawai), 10 (Fantazie) a 20 (Krkovička) se liší. Proto není PDF automaticky sloučeno s aktuálním menu a pole allergens zůstává null.', 'source_url': BASE + 'wp-content/uploads/2024/03/alergeny.pdf'},
    ]
    content = {
        'schema_version': '1.0.0', 'source_url': BASE, 'language': 'cs', 'exported_at': datetime.now(timezone.utc).isoformat(),
        'organization': organization, 'branches': branches,
        'navigation': [{'label': 'Domů', 'url': BASE}, {'label': 'Menu', 'url': BASE + 'menu/'}, {'label': 'Rozvoz', 'url': BASE + 'rozvoz/'}, {'label': 'Objednat pizzu', 'url': BASE + '#objednat', 'type': 'cta'}],
        'pages': [page_by_url[url] for url in primary_urls],
        'menu': {'source_url': BASE + 'menu/', 'currency': 'CZK', 'categories': categories, 'item_count': len(menu_items), 'allergen_documents': [{'source_url': d['source_url'], 'local_path': d['local_path']} for d in documents]},
        'delivery': {'source_url': BASE + 'rozvoz/', 'price_text': 'Cena rozvozu uvnitř okruhu za 45 Kč.', 'price_czk': 45, 'delivery_preparation_minutes': {'min': 30, 'max': 90}, 'pickup_preparation_minutes': {'min': 10, 'max': 30}, 'timing_text': next(line for line in delivery_page['text_lines'] if line.startswith('Přibližná doba')), 'timing_note': 'Pokud potřebujete vědět přesný čas, zavolejte prosím dopředu.', 'areas_by_branch': {b['id']: b['delivery_areas'] for b in branches}, 'embeds': delivery_page['embeds']},
        'documents': documents, 'primary_media': primary_images,
        'archive_files': {'all_pages': 'stranky.json', 'all_media': 'media.json', 'photo_families_and_recommended_originals': 'fotky.json', 'download_audit': 'audit-stazeni.json', 'document_text': 'dokumenty.json', 'photos_directory': 'fotky/', 'graphics_directory': 'grafika/'},
        'source_notes': findings,
    }
    write('obsah.json', content)
    write('menu.json', content['menu'])
    write('organizace.json', {'organization': organization, 'branches': branches, 'delivery': content['delivery']})
    write('stranky.json', pages)

    # Verify every downloadable record has a real file, and the displayed menu is complete.
    for asset in media:
        if asset['status'] == 'downloaded':
            assert (ROOT / asset['local_path']).is_file(), asset['local_path']
    assert len(by_category['Pizzy']['items']) == 24
    assert all(len(item['prices']) == 2 and item['image']['local_path'] for item in by_category['Pizzy']['items'])
    assert len(menu_items) == 69, len(menu_items)
    assert all(item['price_czk'] is not None or item['prices'] for item in menu_items)
    for filename in ROOT.glob('*.json'):
        json.loads(filename.read_text())
    counts = {'pages': len(pages), 'menu_items': len(menu_items), 'menu_categories': {c['name']: len(c['items']) for c in categories}, 'photo_families': len(photo_groups), 'primary_photo_families': sum(g['used_on_primary_pages'] for g in photo_groups.values()), 'photos': len(list((ROOT / 'fotky').glob('*'))), 'graphics': len(list((ROOT / 'grafika').glob('*'))), 'documents': len(documents), 'download_errors': len(audit['errors']), 'failed_assets': len(audit['failed_assets'])}
    write('kontrola.json', {'checked_at': datetime.now(timezone.utc).isoformat(), 'passed': True, 'counts': counts, 'checks': ['All JSON files parse', 'All downloaded media files exist', '24 pizzas each with 2 prices and a local image', '69 current menu items, each with a price', 'Branch phone links and every delivery area match archived source text']})
    print(json.dumps(counts, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
