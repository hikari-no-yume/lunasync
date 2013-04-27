window.AJFChart = (function (window, body) {
    'use strict';

    var colors = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'];

    var makeHalf = function (container, className, list) {
        var half, i, piece;

        half = document.createElement('div');
        half.className = className;
        for (i = 0; i < list.length; i++) {
            piece = document.createElement('div');
            piece.className = 'AJFChartPiece';
            piece.style.backgroundColor = list[i].color;
            piece.style.webkitTransform = piece.style.mozTransform = piece.style.msTransform = piece.style.OTransform = piece.style.transform = 'rotate(' + list[i].rot + 'deg)';
            piece.appendChild(document.createTextNode(list[i].label));
            half.appendChild(piece);
        }
        container.appendChild(half);
    };

    var AJFChart = {
        create: function (parent, width, height, items) {
            var total = 0, halftotal, runningTotal, i, container, list1 = [], list2 = [], color, label;

            if (items.length > 0) {
                for (i = 0; i < items.length; i++) {
                    total += items[i].size;
                }
                halftotal = total / 2;

                runningTotal = 0;
                for (i = 0; i < items.length; i++) {
                    color = colors[i % colors.length];
                    label = items[i].label;

                    if (runningTotal < total / 2) {
                        list1.push({
                            rot: (runningTotal / halftotal) * 180,
                            color: color,
                            label: label
                        });
                        if (runningTotal + items[i].size > total / 2) {
                            list2.push({
                                rot: 0,
                                color: color,
                                label: ''
                            });
                        }
                    } else {
                        list2.push({
                            rot: ((runningTotal - halftotal) / halftotal) * 180,
                            color: color,
                            label: label
                        });
                    }

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
