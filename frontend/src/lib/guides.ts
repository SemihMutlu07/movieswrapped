import type { Metadata } from 'next';

import { catalogs } from '@/i18n/catalogs';
import type { Locale } from '@/i18n/locales';
import { OG_LANDING_IMAGE, SITE_URL } from '@/lib/seo';

export const GUIDE_SLUGS = ['letterboxd-wrapped', 'export-letterboxd-data', 'cinema-scale'] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

export const GUIDE_SITEMAP_PRIORITY: Record<GuideSlug, number> = {
  'letterboxd-wrapped': 0.8,
  'export-letterboxd-data': 0.7,
  'cinema-scale': 0.7,
};

export const GUIDE_PUBLISHED = '2026-10-12';

type GuideSection = { heading: string; paragraphs: string[] };
type GuideFaq = { question: string; answer: string };
type GuideStep = { name: string; text: string };

export type GuideCopy = {
  metaTitle: string;
  description: string;
  kicker: string;
  h1: string;
  breadcrumb: string;
  lede: string;
  sections: GuideSection[];
  howTo?: { name: string; steps: GuideStep[] };
  faqs: GuideFaq[];
  disclaimer: string;
};

const LETTERBOXD_DATA_URL = 'https://letterboxd.com/settings/data/';

function disclaimer(locale: Locale): string {
  return locale === 'tr'
    ? 'Movies Wrapped bağımsız bir projedir. Letterboxd ile bağlantılı değildir, Letterboxd tarafından onaylanmaz ve sponsorluğu yoktur. Letterboxd, sahibinin ticari markasıdır. Resmi yıl özeti Letterboxd’dedir.'
    : 'Movies Wrapped is an independent project. It is not affiliated with, endorsed by, or sponsored by Letterboxd. Letterboxd is a trademark of its owner. The official year-in-review lives on Letterboxd.';
}

function catalogFaq(locale: Locale, key: 'data' | 'free' | 'csv'): GuideFaq {
  const questionKey = `landing.faq.${key}.question` as const;
  const answerKey = `landing.faq.${key}.answer` as const;
  return {
    question: catalogs[locale][questionKey],
    answer: catalogs[locale][answerKey],
  };
}

function englishGuides(): Record<GuideSlug, GuideCopy> {
  return {
    'letterboxd-wrapped': {
      metaTitle: 'Letterboxd Wrapped Explained | Movies Wrapped',
      description:
        'Letterboxd Wrapped is the official January recap (10 diary films, email on January 2). Movies Wrapped builds a free dossier from your export on any day.',
      kicker: 'Independent guide',
      h1: 'What Letterboxd Wrapped is',
      breadcrumb: 'Letterboxd Wrapped',
      lede:
        'Letterboxd Wrapped is Letterboxd’s own year-in-review. Movies Wrapped is a separate, free tool that reads an export you download yourself. They answer different questions, and only one of them is official.',
      sections: [
        {
          heading: 'The official recap',
          paragraphs: [
            'Letterboxd’s help center tells members to open the app, go to Profile, then Stats, then Summaries, and load the latest year or an older one. On the website the same summaries are at https://letterboxd.com/yir/.',
            'That help article says the official emails go out on January 2, that Call Sheet notification settings have to allow those emails, and that a personalized email requires at least 10 films logged in the diary for that year. Watching a film without a diary date is not the same as logging it.',
            'On 2 January 2026 Letterboxd posted that the 2025 Wrapped emails were going out. That January drop is the official product. Movies Wrapped does not send it and does not replace it.',
          ],
        },
        {
          heading: 'What Movies Wrapped adds',
          paragraphs: [
            'Movies Wrapped runs on any day. You export your Letterboxd data and upload the ZIP, or the CSV files inside it. The dossier covers the history in that file: counts, ratings, directors, actors, genres, countries, review analysis, and a cinema-scale score.',
            'There is no Movies Wrapped account. The upload is processed to build the results for that session. Review bodies and the full film list stay on your device.',
          ],
        },
        {
          heading: 'Which one to open',
          paragraphs: [
            'Use Letterboxd when you want the official year-in-review, the January email, or the summaries inside the Letterboxd app.',
            'Use Movies Wrapped when January is months away, when you logged fewer than 10 films this year, or when you want a breakdown of a full export rather than a single diary year.',
          ],
        },
      ],
      faqs: [
        {
          question: 'When does Letterboxd Wrapped come out?',
          answer:
            'Letterboxd’s help center says the official emails go out on January 2. You need Call Sheet notifications turned on, and at least 10 films logged in your diary for that year, to receive the email. In the app, open Profile, then Stats, then Summaries. On the web, the year-in-review page is https://letterboxd.com/yir/.',
        },
        {
          question: 'Is Movies Wrapped the official Letterboxd Wrapped?',
          answer:
            'No. Movies Wrapped is an independent project. It is not affiliated with, endorsed by, or sponsored by Letterboxd.',
        },
        {
          question: 'Can I get a recap before January?',
          answer:
            'Yes, in Movies Wrapped. Upload your Letterboxd export at https://movieswrapped.com/en and the dossier is built from that file. It does not wait for Letterboxd’s January email.',
        },
        catalogFaq('en', 'data'),
      ],
      disclaimer: disclaimer('en'),
    },
    'export-letterboxd-data': {
      metaTitle: 'Export Letterboxd Data | Movies Wrapped',
      description:
        'Export Letterboxd data from Settings → Data → Export Your Data, then upload the ZIP to Movies Wrapped. The phone app has no export; use a browser.',
      kicker: 'How-to',
      h1: 'How to export your Letterboxd data',
      breadcrumb: 'Export Letterboxd data',
      lede:
        'Letterboxd keeps the download on the website, not in the phone app. The reliable way into Movies Wrapped is that ZIP.',
      sections: [
        {
          heading: 'Use a browser, including on a phone',
          paragraphs: [
            `Sign in to Letterboxd on the web. The direct page is ${LETTERBOXD_DATA_URL}. The Letterboxd app does not include this export, so a phone has to use its browser.`,
          ],
        },
        {
          heading: 'Upload the whole export when you can',
          paragraphs: [
            'Letterboxd usually downloads a ZIP. Sometimes it emails the file instead. Upload that ZIP on Movies Wrapped, or upload the CSV files inside it. The full export produces the more complete dossier. A single CSV still works, with a narrower result.',
          ],
        },
      ],
      howTo: {
        name: 'Export your Letterboxd data and open Movies Wrapped',
        steps: [
          {
            name: 'Sign in on the web',
            text: 'Open Letterboxd in a browser. The mobile app has no data export.',
          },
          {
            name: 'Open Settings, then Data',
            text: `From your profile go to Settings, then the Data tab, or open ${LETTERBOXD_DATA_URL} directly.`,
          },
          {
            name: 'Choose Export Your Data',
            text: 'Click Export Your Data.',
          },
          {
            name: 'Confirm the export',
            text: 'Click Confirm when Letterboxd asks you to.',
          },
          {
            name: 'Save the ZIP',
            text: 'The file usually downloads. If it does not, check the email account on your Letterboxd profile.',
          },
          {
            name: 'Upload it to Movies Wrapped',
            text: 'On https://movieswrapped.com/en drop the ZIP, the extracted folder, or the CSV files.',
          },
        ],
      },
      faqs: [
        {
          question: 'Why is there no export button in the Letterboxd app?',
          answer:
            'The Letterboxd app has no data export. Use a browser, including the browser on your phone, and open Settings → Data.',
        },
        {
          question: 'What if Letterboxd emails the file instead of downloading it?',
          answer:
            'Wait for that email and upload the ZIP it contains. Movies Wrapped does not read your inbox.',
        },
        catalogFaq('en', 'csv'),
        catalogFaq('en', 'free'),
        catalogFaq('en', 'data'),
      ],
      disclaimer: disclaimer('en'),
    },
    'cinema-scale': {
      metaTitle: 'Cinema Scale Score | Movies Wrapped',
      description:
        'The Movies Wrapped cinema scale is a 0–100 diversity score (cine_v2) across country, decade, language, volume, genre, and director. Popularity is not included.',
      kicker: 'Scoring',
      h1: 'What the cinema scale score measures',
      breadcrumb: 'Cinema scale',
      lede:
        'The cinema scale is a 0–100 number on your Movies Wrapped dossier. A higher score means the films in your export are spread across more countries, decades, languages, genres, and directors. It is not a grade for taste.',
      sections: [
        {
          heading: 'Six parts, one number',
          paragraphs: [
            'The current formula is named cine_v2. After films in the export are matched to public movie metadata, it reads six things:',
            'Geography: how films split across countries of origin, and whether one country dominates. Time: how they split across decades, and how far the typical release year sits from today. Languages: how they split across original languages, and whether one language dominates. Volume: how many films are in the export, with diminishing returns as the library grows. Genres: how evenly the genre tags are spread. Directors: whether viewing is concentrated in a few directors or spread out.',
            'Those parts combine into a single 0–100 score. The formula rewards spread. It does not reward liking a fixed set of films, writing long reviews, or matching anyone else’s list.',
          ],
        },
        {
          heading: 'Popularity stays out of the score',
          paragraphs: [
            'TMDB popularity is not an input to cine_v2. Popularity fades as a title ages, and mixing it into the score pushed nearly every library into the same high band. A mainstream-versus-niche reading, when the dossier shows one, is separate. It is not added back into the cinema scale.',
          ],
        },
      ],
      faqs: [
        {
          question: 'Does a high cinema scale mean better taste?',
          answer:
            'No. The score measures how spread out the library is. A tight focus on one country, decade, or director can be a real taste and still score lower.',
        },
        {
          question: 'Do popular films raise the cinema scale?',
          answer: 'No. Popularity is not part of cine_v2.',
        },
        {
          question: 'Will my number change?',
          answer:
            'It changes when the export changes. It can also change if Movies Wrapped publishes a new model version. The version attached to the score is the one that produced it. The current version is cine_v2.',
        },
        {
          question: 'Is this an official Letterboxd statistic?',
          answer:
            'No. Letterboxd does not publish this score. Movies Wrapped calculates it from your export.',
        },
      ],
      disclaimer: disclaimer('en'),
    },
  };
}

function turkishGuides(): Record<GuideSlug, GuideCopy> {
  return {
    'letterboxd-wrapped': {
      metaTitle: 'Letterboxd Wrapped nedir? | Movies Wrapped',
      description:
        'Letterboxd Wrapped, resmi Ocak özetidir (yılda 10 günlük kaydı, e-posta 2 Ocak). Movies Wrapped, dışa aktardığınız dosyadan istediğiniz gün ücretsiz bir dosya çıkarır.',
      kicker: 'Bağımsız rehber',
      h1: 'Letterboxd Wrapped nedir?',
      breadcrumb: 'Letterboxd Wrapped',
      lede:
        'Letterboxd Wrapped, Letterboxd’in kendi yıl özetidir. Movies Wrapped ise sizin indirdiğiniz dışa aktarımı okuyan ayrı ve ücretsiz bir araçtır. İkisi farklı sorulara cevap verir ve yalnızca biri resmidir.',
      sections: [
        {
          heading: 'Resmi özet',
          paragraphs: [
            'Letterboxd yardım merkezi, uygulamada Profile → Stats → Summaries yolunu açıp son yılı veya daha eski bir yılı yüklemeyi söyler. Sitede aynı özetler https://letterboxd.com/yir/ adresindedir.',
            'Aynı yardım yazısı, resmi e-postaların 2 Ocak’ta gittiğini, Call Sheet bildirimlerinin açık olması gerektiğini ve kişisel e-posta için o yıl günlüğe en az 10 film kaydedilmiş olması gerektiğini yazar. Tarihi olmayan bir izleme, günlük kaydı değildir.',
            'Letterboxd, 2 Ocak 2026’da 2025 Wrapped e-postalarının gönderildiğini duyurdu. O Ocak gönderimi resmi üründür. Movies Wrapped onu göndermez ve onun yerine geçmez.',
          ],
        },
        {
          heading: 'Movies Wrapped ne ekler?',
          paragraphs: [
            'Movies Wrapped herhangi bir gün çalışır. Letterboxd verinizi dışa aktarır, ZIP’i veya içindeki CSV dosyalarını yüklersiniz. Dosya; sayılar, puanlar, yönetmenler, oyuncular, türler, ülkeler, inceleme analizi ve sinema ölçeği puanını kapsar.',
            'Movies Wrapped hesabı yoktur. Yükleme, o oturumun sonucunu üretmek için işlenir. İnceleme metinleri ve tam film listesi cihazınızda kalır.',
          ],
        },
        {
          heading: 'Hangisini açmalı?',
          paragraphs: [
            'Resmi yıl özetini, Ocak e-postasını veya Letterboxd uygulamasındaki özetleri istiyorsanız Letterboxd’i kullanın.',
            'Ocak aylar sonra ise, bu yıl 10’dan az film kaydettiyseniz veya tek bir yıl yerine tüm dışa aktarımın dökümünü istiyorsanız Movies Wrapped’i kullanın.',
          ],
        },
      ],
      faqs: [
        {
          question: 'Letterboxd Wrapped ne zaman çıkar?',
          answer:
            'Letterboxd yardım merkezi, resmi e-postaların 2 Ocak’ta gittiğini yazar. E-postayı almak için Call Sheet bildirimleri açık olmalı ve o yıl günlüğe en az 10 film kaydedilmiş olmalıdır. Uygulamada Profile → Stats → Summaries. Web’de yıl özeti: https://letterboxd.com/yir/.',
        },
        {
          question: 'Movies Wrapped, resmi Letterboxd Wrapped mı?',
          answer:
            'Hayır. Movies Wrapped bağımsız bir projedir. Letterboxd ile bağlantılı değildir, Letterboxd tarafından onaylanmaz ve sponsorluğu yoktur.',
        },
        {
          question: 'Ocak’tan önce bir özet alabilir miyim?',
          answer:
            'Evet, Movies Wrapped ile. Letterboxd dışa aktarımınızı https://movieswrapped.com/tr adresine yükleyin; dosya o ZIP’ten üretilir. Letterboxd’in Ocak e-postasını beklemez.',
        },
        catalogFaq('tr', 'data'),
      ],
      disclaimer: disclaimer('tr'),
    },
    'export-letterboxd-data': {
      metaTitle: 'Letterboxd verisini dışa aktarma | Movies Wrapped',
      description:
        'Letterboxd verisini Settings → Data → Export Your Data ile indirin, ZIP’i Movies Wrapped’e yükleyin. Telefon uygulamasında dışa aktarma yok; tarayıcı kullanın.',
      kicker: 'Nasıl yapılır',
      h1: 'Letterboxd verisi nasıl dışa aktarılır?',
      breadcrumb: 'Letterboxd verisini dışa aktarma',
      lede:
        'Letterboxd indirmeyi web sitesinde tutar, telefon uygulamasında değil. Movies Wrapped’e girmenin güvenilir yolu o ZIP’tir.',
      sections: [
        {
          heading: 'Telefonda da tarayıcı kullanın',
          paragraphs: [
            `Letterboxd’e web’den giriş yapın. Doğrudan sayfa: ${LETTERBOXD_DATA_URL}. Letterboxd uygulamasında bu dışa aktarma yoktur; telefonda tarayıcı gerekir.`,
          ],
        },
        {
          heading: 'Mümkünse dışa aktarımın tamamını yükleyin',
          paragraphs: [
            'Letterboxd genelde bir ZIP indirir. Bazen dosyayı e-postayla gönderir. O ZIP’i Movies Wrapped’e yükleyin ya da içindeki CSV dosyalarını yükleyin. Tam dışa aktarım daha eksiksiz bir dosya üretir. Tek bir CSV de çalışır; sonuç daha dardır.',
          ],
        },
      ],
      howTo: {
        name: 'Letterboxd verisini dışa aktarıp Movies Wrapped’i açın',
        steps: [
          {
            name: 'Web’den giriş yapın',
            text: 'Letterboxd’i bir tarayıcıda açın. Mobil uygulamada veri dışa aktarma yoktur.',
          },
          {
            name: 'Settings, sonra Data',
            text: `Profilinizden Settings’e, oradan Data sekmesine gidin ya da doğrudan ${LETTERBOXD_DATA_URL} adresini açın.`,
          },
          {
            name: 'Export Your Data’yı seçin',
            text: 'Export Your Data’ya tıklayın.',
          },
          {
            name: 'Dışa aktarmayı onaylayın',
            text: 'Letterboxd sorduğunda Confirm’e tıklayın.',
          },
          {
            name: 'ZIP’i saklayın',
            text: 'Dosya genelde iner. İnmezse Letterboxd profilinizdeki e-posta kutusuna bakın.',
          },
          {
            name: 'Movies Wrapped’e yükleyin',
            text: 'https://movieswrapped.com/tr adresinde ZIP’i, açılmış klasörü veya CSV dosyalarını bırakın.',
          },
        ],
      },
      faqs: [
        {
          question: 'Letterboxd uygulamasında dışa aktarma neden yok?',
          answer:
            'Letterboxd uygulamasında veri dışa aktarma yoktur. Telefonun tarayıcısı dahil bir tarayıcı kullanın ve Settings → Data’yı açın.',
        },
        {
          question: 'Letterboxd dosyayı indirmez de e-postayla gönderirse?',
          answer:
            'O e-postayı bekleyin ve içindeki ZIP’i yükleyin. Movies Wrapped gelen kutunuzu okumaz.',
        },
        catalogFaq('tr', 'csv'),
        catalogFaq('tr', 'free'),
        catalogFaq('tr', 'data'),
      ],
      disclaimer: disclaimer('tr'),
    },
    'cinema-scale': {
      metaTitle: 'Sinema ölçeği puanı | Movies Wrapped',
      description:
        'Movies Wrapped sinema ölçeği, ülke, on yıl, dil, hacim, tür ve yönetmen üzerine kurulu 0–100 çeşitlilik puanıdır (cine_v2). Popülerlik puana girmez.',
      kicker: 'Puanlama',
      h1: 'Sinema ölçeği puanı neyi ölçer?',
      breadcrumb: 'Sinema ölçeği',
      lede:
        'Sinema ölçeği, Movies Wrapped dosyanızdaki 0–100 arası bir sayıdır. Yüksek puan, dışa aktarımdaki filmlerin daha fazla ülkeye, on yıla, dile, türe ve yönetmene yayıldığı anlamına gelir. Zevk notu değildir.',
      sections: [
        {
          heading: 'Altı parça, tek sayı',
          paragraphs: [
            'Güncel formülün adı cine_v2. Dışa aktarımdaki filmler kamu film metadatasıyla eşleştikten sonra altı şeye bakar:',
            'Coğrafya: filmlerin menşe ülkelere dağılımı ve tek bir ülkenin baskın olup olmadığı. Zaman: on yıllara dağılım ve tipik vizyon yılının bugünden ne kadar geride olduğu. Diller: orijinal dillere dağılım ve tek bir dilin baskın olup olmadığı. Hacim: dışa aktarımdaki film sayısı; kütüphane büyüdükçe katkısı azalır. Türler: tür etiketlerinin ne kadar dengeli yayıldığı. Yönetmenler: izlemenin birkaç yönetmende toplanması ya da yayılması.',
            'Bu parçalar tek bir 0–100 puanda birleşir. Formül yayılmayı ödüllendirir. Belirli filmleri sevmek, uzun inceleme yazmak veya başkasının listesine benzemek puanı yükseltmez.',
          ],
        },
        {
          heading: 'Popülerlik puana girmez',
          paragraphs: [
            'TMDB popülerliği cine_v2’nin girdisi değildir. Popülerlik, film eskidikçe düşer; onu puana katmak neredeyse her kütüphaneyi aynı yüksek banda itiyordu. Dosyada ana akım–niş okuması varsa o okuma ayrıdır. Sinema ölçeğine geri eklenmez.',
          ],
        },
      ],
      faqs: [
        {
          question: 'Yüksek sinema ölçeği daha iyi zevk mi demek?',
          answer:
            'Hayır. Puan, kütüphanenin ne kadar yayıldığını ölçer. Tek bir ülkeye, on yıla veya yönetmene odaklanmak gerçek bir zevk olabilir ve yine de daha düşük puan alabilir.',
        },
        {
          question: 'Popüler filmler sinema ölçeğini yükseltir mi?',
          answer: 'Hayır. Popülerlik cine_v2’nin parçası değildir.',
        },
        {
          question: 'Sayım değişir mi?',
          answer:
            'Dışa aktarım değişince değişir. Movies Wrapped yeni bir model sürümü yayınlarsa da değişebilir. Puanın üzerindeki sürüm, onu üreten sürümdür. Güncel sürüm cine_v2’dir.',
        },
        {
          question: 'Bu resmi bir Letterboxd istatistiği mi?',
          answer: 'Hayır. Letterboxd bu puanı yayınlamaz. Movies Wrapped, dışa aktarımınızdan hesaplar.',
        },
      ],
      disclaimer: disclaimer('tr'),
    },
  };
}

const guidesByLocale: Record<Locale, Record<GuideSlug, GuideCopy>> = {
  en: englishGuides(),
  tr: turkishGuides(),
};

export function getGuide(locale: Locale, slug: GuideSlug): GuideCopy {
  return guidesByLocale[locale][slug];
}

export function guideMetadata(locale: Locale, slug: GuideSlug): Metadata {
  const guide = getGuide(locale, slug);
  const path = `/${locale}/${slug}`;
  return {
    title: { absolute: guide.metaTitle },
    description: guide.description,
    alternates: {
      canonical: path,
      languages: {
        en: `/en/${slug}`,
        tr: `/tr/${slug}`,
        'x-default': `/en/${slug}`,
      },
    },
    openGraph: {
      type: 'article',
      url: `${SITE_URL}${path}`,
      siteName: 'Movies Wrapped',
      title: guide.metaTitle,
      description: guide.description,
      images: [{ url: OG_LANDING_IMAGE, width: 1200, height: 630, alt: guide.h1 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: guide.metaTitle,
      description: guide.description,
      images: [OG_LANDING_IMAGE],
    },
    robots: { index: true, follow: true },
  };
}

export function guideJsonLd(locale: Locale, slug: GuideSlug) {
  const guide = getGuide(locale, slug);
  const url = `${SITE_URL}/${locale}/${slug}`;
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: locale === 'tr' ? 'Ana sayfa' : 'Home',
          item: `${SITE_URL}/${locale}`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: guide.breadcrumb,
          item: url,
        },
      ],
    },
    {
      '@type': 'Article',
      '@id': `${url}#article`,
      headline: guide.h1,
      description: guide.description,
      inLanguage: locale,
      mainEntityOfPage: url,
      datePublished: GUIDE_PUBLISHED,
      dateModified: GUIDE_PUBLISHED,
      author: { '@id': `${SITE_URL}/#organization` },
      publisher: { '@id': `${SITE_URL}/#organization` },
      isPartOf: { '@id': `${SITE_URL}/${locale}/#website` },
    },
    {
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      url,
      inLanguage: locale,
      mainEntity: guide.faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
  ];

  if (guide.howTo) {
    graph.push({
      '@type': 'HowTo',
      '@id': `${url}#howto`,
      name: guide.howTo.name,
      inLanguage: locale,
      step: guide.howTo.steps.map((step, index) => ({
        '@type': 'HowToStep',
        position: index + 1,
        name: step.name,
        text: step.text,
      })),
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}
