// په دې نسخه کې هر ملاقات ۳۰ دقیقې او د کابل په وخت دی.
export const slotMinutes = 30;

export function getDayBounds(date) {
  const start = new Date(date + 'T00:00:00+04:30');
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// یوازې کاري وختونه جوړوي؛ د DB نیول شوي وختونه controller ګوري.
export function getWorkingSlots(doctor, date) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayNumber = new Date(date + 'T00:00:00Z').getUTCDay();
  const day = days[dayNumber];
  const { start } = getDayBounds(date);
  const slots = [];

  for (const period of doctor.availability) {
    if (period.day !== day) {
      continue;
    }

    const [startHour, startMinute] = period.startTime.split(':');
    const [endHour, endMinute] = period.endTime.split(':');
    const firstMinute = Number(startHour) * 60 + Number(startMinute);
    const lastMinute = Number(endHour) * 60 + Number(endMinute);

    // د 09:00 او 09:30 په څېر بشپړ، برابر وختونه کاروو.
    const firstSlot = Math.ceil(firstMinute / slotMinutes) * slotMinutes;
    for (let minute = firstSlot; minute + slotMinutes <= lastMinute; minute += slotMinutes) {
      const hourText = String(Math.floor(minute / 60)).padStart(2, '0');
      const minuteText = String(minute % 60).padStart(2, '0');
      const startAt = new Date(start.getTime() + minute * 60 * 1000);
      const endAt = new Date(startAt.getTime() + slotMinutes * 60 * 1000);
      slots.push({ startTime: hourText + ':' + minuteText, startAt, endAt });
    }
  }

  slots.sort((first, second) => first.startAt - second.startAt);
  return slots;
}
