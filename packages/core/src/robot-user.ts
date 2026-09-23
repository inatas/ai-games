/** A user identity controlled by a server-side robot, independent of a game seat. */
export interface RobotPublicUser {
  userId: string;
  nickname: string;
  gender: 'male' | 'female' | 'unspecified';
  avatar: { src: string; size: string; position: string };
  portrait: { src: string; variant: string };
}
export interface ScriptRobotUser extends RobotPublicUser {
  kind: 'robot';
  persona: { mode: 'fixed'; description: string };
  control: { kind: 'script'; strategy: 'fixed' | 'random'; speech: string; modelProfile: null };
}

export type RobotUser = Omit<ScriptRobotUser, 'control'> & {
  control: ScriptRobotUser['control'] | { kind: 'model'; modelProfile: string };
};
