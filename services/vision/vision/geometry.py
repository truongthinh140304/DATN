from __future__ import annotations

from collections.abc import Callable, Sequence

from .domain import BoundingBox, Point


def polygon_area(points: Sequence[Point]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        area += point[0] * next_point[1] - next_point[0] * point[1]
    return abs(area) / 2.0


def point_in_polygon(point: Point, polygon: Sequence[Point]) -> bool:
    if len(polygon) < 3:
        return False

    x, y = point
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
        if abs(cross) < 1e-9 and min(x1, x2) <= x <= max(x1, x2) and min(
            y1, y2
        ) <= y <= max(y1, y2):
            return True
        if (y1 > y) != (y2 > y):
            intersection_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x <= intersection_x:
                inside = not inside
        previous = current
    return inside


def _clip_edge(
    polygon: Sequence[Point],
    inside: Callable[[Point], bool],
    intersection: Callable[[Point, Point], Point],
) -> list[Point]:
    if not polygon:
        return []
    output: list[Point] = []
    previous = polygon[-1]
    previous_inside = inside(previous)
    for current in polygon:
        current_inside = inside(current)
        if current_inside:
            if not previous_inside:
                output.append(intersection(previous, current))
            output.append(current)
        elif previous_inside:
            output.append(intersection(previous, current))
        previous = current
        previous_inside = current_inside
    return output


def clip_polygon_to_box(
    polygon: Sequence[Point], bbox: BoundingBox
) -> list[Point]:
    x1, y1, x2, y2 = bbox

    def intersect_x(edge_x: float) -> Callable[[Point, Point], Point]:
        def calculate(start: Point, end: Point) -> Point:
            if end[0] == start[0]:
                return edge_x, start[1]
            ratio = (edge_x - start[0]) / (end[0] - start[0])
            return edge_x, start[1] + ratio * (end[1] - start[1])

        return calculate

    def intersect_y(edge_y: float) -> Callable[[Point, Point], Point]:
        def calculate(start: Point, end: Point) -> Point:
            if end[1] == start[1]:
                return start[0], edge_y
            ratio = (edge_y - start[1]) / (end[1] - start[1])
            return start[0] + ratio * (end[0] - start[0]), edge_y

        return calculate

    clipped = list(polygon)
    clipped = _clip_edge(clipped, lambda p: p[0] >= x1, intersect_x(x1))
    clipped = _clip_edge(clipped, lambda p: p[0] <= x2, intersect_x(x2))
    clipped = _clip_edge(clipped, lambda p: p[1] >= y1, intersect_y(y1))
    clipped = _clip_edge(clipped, lambda p: p[1] <= y2, intersect_y(y2))
    return clipped


def representative_points(bbox: BoundingBox) -> tuple[Point, Point, Point]:
    x1, y1, x2, y2 = bbox
    width = x2 - x1
    height = y2 - y1
    ground_y = y1 + height * 0.9
    return (
        (x1 + width * 0.25, ground_y),
        (x1 + width * 0.5, ground_y),
        (x1 + width * 0.75, ground_y),
    )


def overlap_metrics(
    bbox: BoundingBox, polygon: Sequence[Point]
) -> tuple[float, float, float]:
    x1, y1, x2, y2 = bbox
    box_area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    roi_area = polygon_area(polygon)
    intersection_area = polygon_area(clip_polygon_to_box(polygon, bbox))
    box_overlap = intersection_area / box_area if box_area else 0.0
    roi_overlap = intersection_area / roi_area if roi_area else 0.0
    anchor_ratio = sum(
        point_in_polygon(point, polygon) for point in representative_points(bbox)
    ) / 3.0
    return box_overlap, roi_overlap, anchor_ratio


def assignment_evidence(bbox: BoundingBox, polygon: Sequence[Point]) -> float:
    box_overlap, roi_overlap, anchor_ratio = overlap_metrics(bbox, polygon)
    overlap_score = max(box_overlap, roi_overlap)
    return min(1.0, overlap_score * 0.7 + anchor_ratio * 0.3)
