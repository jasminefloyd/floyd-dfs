export const SPORTS = ['nba', 'wnba', 'nfl', 'mlb', 'f1'];
export const CONTEST_TYPES = ['showdown', 'classic'];

export const DK_SCORING = {
  nba: {
    points: 1,
    rebounds: 1.25,
    assists: 1.5,
    steals: 2,
    blocks: 2,
    turnovers: -0.5,
    three_pointers: 0.5
  },
  wnba: {
    points: 1,
    rebounds: 1.25,
    assists: 1.5,
    steals: 2,
    blocks: 2,
    turnovers: -0.5,
    three_pointers: 0.5
  },
  nfl: {
    passing_yards: 0.04,
    passing_td: 6,
    interception: -2,
    rushing_yards: 0.1,
    rushing_td: 6,
    receiving_yards: 0.1,
    receiving_td: 6,
    reception: 0.5
  },
  mlb: {
    single: 3,
    double: 6,
    triple: 9,
    home_run: 12,
    rbi: 1.5,
    run: 1.2,
    stolen_base: 3,
    strikeout: -0.5,
    walk: 1
  },
  f1: {
    position_finish: 1,
    pole_position: 1.5,
    fastest_lap: 1.5
  }
};
