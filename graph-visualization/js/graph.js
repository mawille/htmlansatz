// Beispielgraph als JSON-Objekt
const graphData = {
    nodes: [
        { id: "root", name: "Root-Knoten", type: "root" },
        { id: "node1", name: "Erster Knoten", type: "branch" },
        { id: "node2", name: "Zweiter Knoten", type: "leaf" }
    ],
    links: [
        { source: "root", target: "node1" },
        { source: "node1", target: "node2" }
    ]
};

// Graphen-Container
const container = d3.select("#graph-container")
                    .append("svg")
                    .attr("width", 800)
                    .attr("height", 600);

// Simulation für Layout
const simulation = d3.forceSimulation(graphData.nodes)
    .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(150))
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(400, 300));

// Linien für die Verbindungen
const link = container.selectAll(".link")
    .data(graphData.links)
    .enter().append("line")
    .attr("class", "link")
    .style("stroke", "#999")
    .style("stroke-width", 2);

// Knoten erstellen
const node = container.selectAll(".node")
    .data(graphData.nodes)
    .enter().append("circle")
    .attr("class", "node")
    .attr("r", 20)
    .style("fill", "#69b3a2")
    .call(d3.drag()
        .on("start", dragStarted)
        .on("drag", dragged)
        .on("end", dragEnded)
    );

// Knoten-Beschriftung hinzufügen
const labels = container.selectAll(".label")
    .data(graphData.nodes)
    .enter().append("text")
    .attr("class", "label")
    .attr("text-anchor", "middle")
    .attr("dy", ".35em")
    .text(d => d.name);

// Simulation aktualisieren
simulation.on("tick", () => {
    link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

    node
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);

    labels
        .attr("x", d => d.x)
        .attr("y", d => d.y);
});

// Drag-Handler
function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

function addNode(newNode) {
    graphData.nodes.push(newNode);
    updateGraph();
}
function filterNodesByType(type) {
    const filteredNodes = graphData.nodes.filter(node => node.type === type);
    updateGraph(filteredNodes);
}

function highlightPathToRoot(clickedNode) {
    let currentNode = clickedNode;
    const path = [];

    while (currentNode) {
        path.push(currentNode);
        currentNode = graphData.links.find(link => link.target.id === currentNode.id)?.source;
    }

    // Highlight alle Knoten im Pfad
    container.selectAll(".node")
        .style("fill", d => path.includes(d) ? "orange" : "#69b3a2");
}
