export interface ApiPagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiSuccessResponse<T> {
  code: 0;
  message: 'success';
  data: T;
  pagination?: ApiPagination;
}

export interface ApiErrorResponse {
  code: number;
  message: string;
  data: null;
}

export function ok<T>(data: T, pagination?: ApiPagination): ApiSuccessResponse<T> {
  return {
    code: 0,
    message: 'success',
    data,
    ...(pagination ? { pagination } : {}),
  };
}