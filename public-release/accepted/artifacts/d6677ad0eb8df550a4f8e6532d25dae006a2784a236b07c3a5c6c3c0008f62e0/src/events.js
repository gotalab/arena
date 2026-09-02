// Event History Manager for STOMP Telemetry

export class EventManager {
  constructor(maxHistory = 200) {
    this.maxHistory = maxHistory;
    this.sequence = 0;
    this.recentEvents = [];
    this.lastEvent = null;
  }

  reset() {
    this.sequence = 0;
    this.recentEvents = [];
    this.lastEvent = null;
  }

  /**
   * Record a game event
   * @param {Object} params
   * @param {string} params.kind - machine_jump, machine_land, ball_bounce_weak, ball_bounce_normal, ball_bounce_power, top_hit, enemy_defeated, wrong_side_hit, ball_drop, ground_stomp
   * @param {number} params.tick
   * @param {number|string|null} [params.enemyId=null]
   * @param {number} [params.amountMs=0]
   * @param {'ball'|'machine'|'system'} params.source
   * @param {'top'|'non_top'|'body'|null} [params.contact=null]
   */
  emit({ kind, tick, enemyId = null, amountMs = 0, source, contact = null }) {
    this.sequence += 1;
    const event = {
      sequence: this.sequence,
      kind,
      tick,
      enemyId,
      amountMs,
      source,
      contact
    };

    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxHistory) {
      this.recentEvents.shift();
    }
    this.lastEvent = event;
    return event;
  }
}
