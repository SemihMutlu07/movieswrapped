import Link from 'next/link';

import type { Locale } from '@/i18n/locales';
import { GUIDE_SLUGS, getGuide, guideJsonLd, type GuideSlug } from '@/lib/guides';

export default function GuideArticle({ locale, slug }: { locale: Locale; slug: GuideSlug }) {
  const guide = getGuide(locale, slug);
  const homeLabel = locale === 'tr' ? 'Ana sayfa' : 'Home';
  const faqLabel = locale === 'tr' ? 'Sıkça sorulan sorular' : 'Frequently asked questions';
  const relatedLabel = locale === 'tr' ? 'İlgili sayfalar' : 'Related pages';
  const others = GUIDE_SLUGS.filter((item) => item !== slug);

  return (
    <article className="mx-auto w-full max-w-3xl px-5 pb-24 pt-[var(--mw-top-chrome-reserve)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(guideJsonLd(locale, slug)) }}
      />
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-white/50">
          <li>
            <Link href={`/${locale}`} className="text-orange-400 hover:text-orange-300">
              {homeLabel}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-white/80">{guide.breadcrumb}</li>
        </ol>
      </nav>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.16em] text-orange-400">{guide.kicker}</p>
      <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-extrabold leading-tight text-white">
        {guide.h1}
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-white/80">{guide.lede}</p>
      {guide.sections.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="text-2xl font-bold text-white">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-3 leading-relaxed text-white/75">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      {guide.howTo ? (
        <section className="mt-10 rounded-2xl border border-white/8 bg-white/[0.03] p-5">
          <h2 className="text-2xl font-bold text-white">{guide.howTo.name}</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-white/80">
            {guide.howTo.steps.map((step) => (
              <li key={step.name}>
                <span className="font-semibold text-white">{step.name}. </span>
                {step.text}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <section className="mt-12">
        <h2 className="text-2xl font-bold text-white">{faqLabel}</h2>
        <div className="mt-4 space-y-3">
          {guide.faqs.map((faq) => (
            <details key={faq.question} open className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <summary className="cursor-pointer font-semibold text-white">{faq.question}</summary>
              <p className="mt-2 leading-relaxed text-white/75">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="mt-12">
        <h2 className="text-xl font-bold text-white">{relatedLabel}</h2>
        <ul className="mt-3 space-y-2">
          {others.map((other) => (
            <li key={other}>
              <Link href={`/${locale}/${other}`} className="text-orange-400 hover:text-orange-300">
                {getGuide(locale, other).h1}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-10 text-sm leading-relaxed text-white/45">{guide.disclaimer}</p>
    </article>
  );
}
