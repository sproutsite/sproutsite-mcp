import type { Document, Language, Snapshot } from './snapshot.js';

function words(text: string): Set<string> {
  const normalized = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return new Set(normalized.match(/[\p{L}\p{N}]+/gu) ?? []);
}

export class Documentation {
  readonly version: string;
  readonly sourceCommit: string | null;
  private readonly byId: Map<string, Document>;
  private readonly byPage: Map<string, Document>;
  private readonly components: Map<string, Snapshot['components'][number]>;
  private readonly index;

  constructor(snapshot: Snapshot) {
    this.version = snapshot.sproutsiteVersion;
    this.sourceCommit = snapshot.source.commit;
    this.byId = new Map(snapshot.documents.map((document) => [document.id, document]));
    this.byPage = new Map(snapshot.documents.map((document) => [`${document.pageId}:${document.locale}`, document]));
    this.components = new Map(snapshot.components.map((component) => [component.name.toLowerCase(), component]));

    const componentNames = new Map<string, string[]>();
    for (const { name, documents } of snapshot.components) {
      for (const { id } of documents) {
        const names = componentNames.get(id) ?? [];
        names.push(name);
        componentNames.set(id, names);
      }
    }

    this.index = snapshot.documents.map((document) => ({
      document,
      title: words([document.title, document.heading, ...componentNames.get(document.id) ?? []].join(' ')),
      description: words(document.description),
      body: words(document.searchText),
    }));
  }

  private summary(document: Document) {
    const { id, pageId, title, description, kind, locale, url } = document;
    return { id, pageId, title, description, kind, url, language: locale, sproutsiteVersion: this.version };
  }

  private details(document: Document) {
    return {
      ...this.summary(document),
      heading: document.heading,
      markdown: document.markdown,
      translations: document.translations,
      sections: document.sections.map((section) => ({
        id: section.id,
        markdown: section.markdown,
        imports: section.imports,
        headings: section.headings,
        examples: section.examples,
        tables: section.tables,
        notices: section.notices,
        unresolvedExpressions: section.unresolvedExpressions,
      })),
    };
  }

  search(query: string, language: Language, limit: number) {
    const terms = [...words(query)];
    return this.index
      .filter(({ document }) => document.locale === language)
      .map(({ document, title, description, body }) => {
        let matches = 0;
        let score = 0;
        for (const term of terms) {
          const weight = title.has(term) ? 8 : description.has(term) ? 3 : body.has(term) ? 1 : 0;
          matches += Number(weight > 0);
          score += weight;
        }
        return { document, matches, score };
      })
      .filter(({ matches }) => matches > 0)
      .sort((a, b) => b.matches - a.matches || b.score - a.score || a.document.id.localeCompare(b.document.id, 'en'))
      .slice(0, limit)
      .map(({ document }) => this.summary(document));
  }

  getDocument(id: string, language?: Language) {
    const exact = this.byId.get(id);
    const document = exact && language === undefined
      ? exact
      : this.byPage.get(`${exact?.pageId ?? id}:${language ?? 'en'}`);
    return document && this.details(document);
  }

  getComponent(name: string, language: Language) {
    const component = this.components.get(name.toLowerCase());
    const id = component?.documents.find((reference) => reference.locale === language)?.id;
    const document = id && this.byId.get(id);
    if (!component || !document) return undefined;
    return { name: component.name, importPath: component.importPath, ...this.details(document) };
  }
}
