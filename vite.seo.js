// Adds search-engine data to index.html at build time: the site URL in canonical
// and Open Graph tags, and JSON-LD (business, service with the 50% offer, FAQ).
import { T, CITIES } from './src/content.js';

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

export default function seo() {
  let siteUrl = '';
  return {
    name: 'niptao-seo',
    configResolved(config) {
      siteUrl = (config.env.VITE_SITE_URL || process.env.SITE_URL || 'https://www.niptao.co.in').replace(/\/$/, '');
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('index.html')) return html;
        const brand = 'Niptao';
        const areas = Object.values(CITIES).map((c) => ({ '@type': 'City', name: c.name.en }));
        const data = [
          {
            '@context': 'https://schema.org', '@type': 'ProfessionalService', '@id': `${siteUrl}/#business`,
            name: brand, url: `${siteUrl}/`, areaServed: areas, priceRange: '50% of challan amount',
            description: 'Private facilitation service that settles pending traffic e-challans at Lok Adalat on the customer\'s behalf.',
          },
          {
            '@context': 'https://schema.org', '@type': 'Service', name: 'Traffic challan settlement at Lok Adalat',
            serviceType: 'Traffic e-challan settlement', provider: { '@id': `${siteUrl}/#business` }, areaServed: areas,
            offers: { '@type': 'Offer', name: 'Flat 50% off on your challans', description: 'Pay 50% of the eligible challan amount. Free check; pay only after eligibility is confirmed.', priceCurrency: 'INR', url: `${siteUrl}/` },
          },
          {
            '@context': 'https://schema.org', '@type': 'FAQPage',
            mainEntity: T.en.faqs.map((f) => ({ '@type': 'Question', name: fill(f.q, { brand }), acceptedAnswer: { '@type': 'Answer', text: fill(f.a, { brand }) } })),
          },
        ];
        const ld = data.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n  ');
        return html.replaceAll('%SITE_URL%', siteUrl).replace('<!--structured-data-->', ld);
      },
    },
  };
}
