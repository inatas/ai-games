import { createContext, useContext } from 'react';
import type { RobotPublicUser } from '@game-ai/core';
export const RobotUsersContext = createContext<{ seat: number; user?: RobotPublicUser }[]>([]);
export function useRobotUsers() { return useContext(RobotUsersContext); }
export function useRobotUser(seat: number | null) { return useRobotUsers().find(player => player.seat === seat)?.user; }
