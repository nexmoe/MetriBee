export type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  role?: string;
  createdAt: string | Date;
};

export interface UsersResponse {
  data?: {
    users: AdminUser[];
    total: number;
    limit?: number;
    offset?: number;
  };
}
