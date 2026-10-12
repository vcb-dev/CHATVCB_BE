export type JwtPayload = {
  sub: string;
  id?: string;
  name: string;
  email: string;
  team: string;
};

export function actorId(user: JwtPayload) {
  return user.sub || user.id || '';
}
