// Per-lane hit-contribution metric (S3.1.1 DoD). Kept in core so the emitted number is
// provable without Postgres: given the FINAL fused ids and each lane's raw
// candidate ids, report how many of the returned ids each lane surfaced. A fused
// id present in several lanes counts once for each lane; candidates that never
// entered the fused set contribute nothing.
export function laneHitContributions(input: {
  fusedIds: readonly string[];
  lanes: readonly { lane: string; candidateIds: readonly string[] }[];
}): { lane: string; hitCount: number }[] {
  return input.lanes.map((lane) => {
    const surfaced = new Set(lane.candidateIds);
    return {
      lane: lane.lane,
      hitCount: input.fusedIds.filter((id) => surfaced.has(id)).length,
    };
  });
}
