/* Local pictograms keep the board readable at different zoom levels and offline. */
(() => {
  const drawings = {
    museum: 'M2 9L12 3L22 9ZM4 20H20M2 23H22M5 11V17M10 11V17M14 11V17M19 11V17',
    calendar: 'M4 5H20V21H4ZM4 10H20M8 3V7M16 3V7M8 14H10M14 14H16M8 17H10',
    book: 'M12 6Q8 3 3 5V19Q8 17 12 20Q16 17 21 19V5Q16 3 12 6ZM12 6V20',
    floor: 'M3 3H11V11H3ZM14 3H21V11H14ZM3 14H11V21H3ZM14 14H21V21H14Z',
    fit: 'M3 9V3H9M15 3H21V9M21 15V21H15M9 21H3V15',
    dice: 'M5 3H19Q21 3 21 5V19Q21 21 19 21H5Q3 21 3 19V5Q3 3 5 3ZM7 7H8M12 12H13M16 17H17',
    coins: 'M3 7C3 3 16 3 16 7C16 11 3 11 3 7ZM3 7V11C3 15 16 15 16 11V7M7 15V17C7 21 21 21 21 17V13Q21 11 18 10M9 16Q15 19 21 14',
    guide: 'M4 9L5 5L17 4L20 7L15 9ZM6 10H18M8 11V14Q12 20 16 14V11M8 17L4 19L3 22H21L20 19L16 17M10 18L12 21L14 18',
    lamp: 'M7 3H17L21 13H3ZM12 14V19M7 21H17M6 22H18M18 14V16',
    banker: 'M3 5H21V21H3ZM6 8H18V17H6ZM3 10H5M3 15H5M12 9V14M10 13L14 10M10 10L14 13',
    alchemist: 'M9 3H15M10 4V10L4 19Q3 21 6 21H18Q21 21 20 19L14 10V4M7 16H17M10 18H11',
    thief: 'M4 8L8 4L15 4L20 8M2 10H22M5 12Q12 15 19 12L17 17L13 16L11 16L7 17ZM6 19L3 22M18 19L21 22',
    dairy: 'M7 4H17M8 5V8L5 12V21H19V12L16 8V5M6 14H18M6 18H18',
    scribe: 'M4 20L11 12M6 17Q5 9 13 5L21 3L18 10L13 16ZM11 12L18 6M3 22H13',
    archivist: 'M3 5H21V9H3ZM5 9V21H19V9M9 13H15V16H9Z',
    collector: 'M3 8H21V20H3ZM8 8V6Q8 3 12 3Q16 3 16 6V8M3 13H21M11 12H13V15H11Z',
    curator: 'M3 3H21V19H3ZM6 6H18V16H6ZM8 14L11 10L14 13L16 11M12 19V22M8 22H16',
    critic: 'M4 5H20V17H10L5 21V17H4ZM7 9H17M7 13H13',
    fidget: 'M11 3H15M13 4V6M17 7L19 5M13 7A7 7 0 1 1 12.9 7ZM13 10V14L16 15',
    sweeper: 'M12 12L19 3M10 10L15 14L9 22L2 17ZM4 18L8 14M7 20L11 16',
    firework: 'M12 2V6M19 5L16 8M22 12H18M19 19L16 16M12 22V18M5 19L8 16M2 12H6M5 5L8 8M12 9L15 12L12 15L9 12Z',
    carver: 'M4 18L9 13L12 16L7 21ZM10 12L18 4L21 3L20 7L13 15Z',
    die_coin: 'M5 7Q5 3 13 3Q20 3 20 7Q20 11 13 11Q5 11 5 7ZM5 7V11Q5 15 13 15Q20 15 20 11V7M3 13V17Q3 21 11 21Q17 21 18 17',
    die_scroll: 'M2 6Q7 4 12 8Q17 4 22 6V19Q17 17 12 21Q7 17 2 19ZM12 8V21M5 9L9 10M15 10L19 9',
    die_cheese: 'M5 3V9Q7 13 9 9V3M7 3V21M18 3Q14 6 14 13H18M18 3V21',
    coin: 'M12 3A9 9 0 1 1 11.9 3ZM12 6A6 6 0 1 1 11.9 6ZM12 9V15',
    ingot: 'M4 11L15 6L20 8L22 15L10 20L2 16ZM4 11L10 14L20 8M10 14V20',
    cheese: 'M3 12L16 4L21 9L3 15ZM3 15V20L21 14V9M8 16H9M15 13H16',
    scroll: 'M6 4H18Q21 4 20 8H17M17 7V18Q17 21 14 21H4Q7 20 7 17V7Q7 5 6 4ZM9 10H14M9 13H14',
    spark: 'M12 2L14 9L21 12L14 15L12 22L10 15L3 12L10 9Z',
    dust: 'M3 17Q2 12 7 11Q8 5 13 9Q18 7 19 12Q24 14 20 18H5ZM6 21H8M16 21H17',
    arrow: 'M3 12H20M14 6L20 12L14 18',
    replay: 'M4 10A8 8 0 1 1 5 18M4 4V10H10',
    pulse: 'M2 13H6L9 6L13 19L16 10L18 13H22',
    flag: 'M5 22V3M6 4Q11 1 14 5Q17 8 21 4V14Q17 17 13 13Q10 10 6 13',
    bag: 'M4 8H20L21 21H3ZM8 9V7A4 4 0 0 1 16 7V9',
    list: 'M4 6H5M9 6H20M4 12H5M9 12H20M4 18H5M9 18H20'
  };

  const filled = {
    guide: [['#d6ac72','M4 9L5 5L17 4L20 7L15 9Z'],['#f1d8b5','M8 10H16V14Q12 20 8 14Z'],['#a1b8a2','M8 17L4 19L3 22H21L20 19L16 17L12 21Z']],
    lamp: [['#ebc276','M7 3H17L21 13H3Z'],['#be884d','M7 12H20V14H5ZM11 14H13V20H11ZM7 20H17V22H7Z']]
  };
  function paint(name, canvas, colorful = false) {
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.height = 96;
    ctx.scale(4, 4);
    if (colorful) {
      for (const [color, path] of filled[name] || []) {
        ctx.fillStyle = color;
        ctx.fill(new Path2D(path));
      }
    }
    ctx.strokeStyle = colorful ? '#29463c' : getComputedStyle(canvas).color;
    ctx.lineWidth = colorful ? 1.3 : 1.65;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(new Path2D(drawings[name] || drawings.museum));
  }
  function render(root = document) {
    for (const holder of root.querySelectorAll('[data-icon]:not([data-painted])')) {
      holder.dataset.painted = '1';
      holder.setAttribute('aria-hidden', 'true');
      const canvas = document.createElement('canvas');
      holder.append(canvas);
      paint(holder.dataset.icon, canvas, holder.hasAttribute('data-color'));
    }
  }
  window.MuseumSymbols = {render};
})();
