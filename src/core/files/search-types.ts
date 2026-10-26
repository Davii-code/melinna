export interface ProjectSearchQuery {
  /** Raízes do workspace ativo; o principal confere cada uma contra as raízes registradas. */
  roots: string[];
  text: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Máscaras de arquivo separadas por vírgula (`*.ts, src/**`); vazio = todos. */
  include?: string;
  /** Máscaras que ficam de fora, no mesmo formato. */
  exclude?: string;
}

export interface SearchHit {
  path: string;
  /** Linha a partir de 1. */
  line: number;
  /** Coluna da ocorrência a partir de 1. */
  column: number;
  /** A linha (cortada se muito longa); `matchStart`/`matchEnd` são posições nela. */
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface ProjectSearchResult {
  hits: SearchHit[];
  /** Parou nos primeiros 2.000 resultados. */
  truncated: boolean;
  scannedFiles: number;
  /** Arquivos pulados por falta de permissão de leitura. */
  skipped: number;
}
