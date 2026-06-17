export interface CertRow {
  hs_code: string;
  product_name: string;
  doc_number: string;
  doc_date: string | null;
  source_file: string;
}

export interface ExtractedItem {
  index: number;
  part_number: string;
  hs_code: string;
  description: string;
  qty: string;
  country: string;
}

export interface MatchResult {
  index: number;
  part_number: string;
  hs_code: string;
  description: string;
  country: string;
  status: 'found' | 'not_found' | 'not_required';
  cert_number: string | null;
  cert_date: string | null;
  cert_description: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface CheckResponse {
  total: number;
  found: number;
  not_found: number;
  not_required: number;
  results: MatchResult[];
}
