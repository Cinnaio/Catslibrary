/// Tracks the query that produced the visible list and rejects superseded responses.
public struct ListRequestGuard<Query: Equatable> {
    public struct Ticket: Equatable {
        fileprivate let generation: UInt
        public let query: Query
    }

    private var generation: UInt = 0
    private var active: Ticket?
    private var loadedQuery: Query?

    public init() {}
    public var isLoading: Bool { active != nil }

    public mutating func begin(_ query: Query) -> Ticket {
        generation &+= 1
        let ticket = Ticket(generation: generation, query: query)
        active = ticket
        return ticket
    }

    public mutating func beginNext(_ query: Query) -> Ticket? {
        guard active == nil, loadedQuery == query else { return nil }
        return begin(query)
    }

    public func accepts(_ ticket: Ticket, query: Query) -> Bool {
        active == ticket && ticket.query == query
    }

    public mutating func finish(_ ticket: Ticket, succeeded: Bool = false) {
        guard active == ticket else { return }
        if succeeded { loadedQuery = ticket.query }
        active = nil
    }
}
