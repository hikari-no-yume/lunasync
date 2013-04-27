// AJFChart is a simple JS library that draws pie charts
// It uses only CSS3, no SVG. Requires chart.css to be used with script.
window.AJFChart = (function (window, body) {
    'use strict';

    var colors = ['rgb(253, 90, 181)', 'rgb(249, 222, 231)', 'rgb(252, 118, 171)', 'rgb(211, 44, 136)', 'rgb(149, 216, 245)', 'rgb(255, 250, 184)'];

    // produces one half of the pie chart, from data
    // extracted out for DRY principle (two halves)
    var makeHalf = function (container, className, list) {
        var half, i, piece, label;

        half = document.createElement('div');
        half.className = className;
        for (i = 0; i < list.length; i++) {
            piece = document.createElement('div');
            piece.className = 'AJFChartPiece';
            piece.style.backgroundColor = list[i].color;
            piece.style.webkitTransform = piece.style.mozTransform = piece.style.msTransform = piece.style.OTransform = piece.style.transform = 'rotate(' + list[i].rot + 'deg)';
            label = document.createElement('div');
            label.className = 'AJFChartLabel';
            label.appendChild(document.createTextNode(list[i].label));
            piece.appendChild(label);
            half.appendChild(piece);
        }
        container.appendChild(half);
    };

    var AJFChart = {
        create: function (parent, width, height, items) {
            var total = 0, halftotal, runningTotal, i, container, list1 = [], list2 = [], color, label;

            // empty charts don't need any segments
            if (items.length > 0) {
                // total up the segment sizes
                for (i = 0; i < items.length; i++) {
                    total += items[i].size;
                }
                // half total, total for each half
                halftotal = total / 2;

                // how far are we round the circle just now?
                runningTotal = 0;
                for (i = 0; i < items.length; i++) {
                    color = colors[i % colors.length];
                    label = items[i].label;

                    // if we're within the first half
                    if (runningTotal < total / 2) {
                        list1.push({
                            rot: (runningTotal / halftotal) * 180,
                            color: color,
                            label: label
                        });
                        // if we span both
                        if (runningTotal + items[i].size > total / 2) {
                            // add dummy segment to second half
                            list2.push({
                                rot: 0,
                                color: color,
                                label: ''
                            });
                        }
                    // if we're within the second half
                    } else {
                        list2.push({
                            rot: ((runningTotal - halftotal) / halftotal) * 180,
                            color: color,
                            label: label
                        });
                    }

                    // we're now further round the circle
                    runningTotal += items[i].size;
                }
            }

            container = document.createElement('div');
            container.className = 'AJFChart';
            container.style.width = width + 'px';
            container.style.height = height + 'px';
            makeHalf(container, 'AJFChartHalf1', list1);
            makeHalf(container, 'AJFChartHalf2', list2);
            parent.appendChild(container);
        }
    };

    return AJFChart;
}(window, document.body));
