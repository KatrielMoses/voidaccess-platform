/** Shared shapes for content files. Text may contain {{tokens}} (see README.md); prices are never typed here. */
export interface Section {
  id?: string;
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface Faq {
  q: string;
  a: string;
}

export interface PageMeta {
  title: string;
  description: string;
}

export interface LegalPage {
  meta: PageMeta;
  title: string;
  updated: string;
  draftNotice: string;
  intro: string;
  sections: Section[];
}
